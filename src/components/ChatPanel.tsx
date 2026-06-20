import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart } from "ai";
import type { UIMessage } from "ai";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { Badge, Button, Empty, InputArea, Surface, Text } from "@cloudflare/kumo";
import {
  GearIcon,
  PaperPlaneRightIcon,
  RobotIcon,
  StopIcon,
  TrashIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { SongState } from "../music/song";
import type { ConnectionStatus } from "../client";

type AgentConnection = ReturnType<typeof useAgent<SongState>>;

function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const dot =
    status === "connected"
      ? "bg-green-500"
      : status === "connecting"
        ? "bg-yellow-500"
        : "bg-red-500";
  const label =
    status === "connected" ? "Connected" : status === "connecting" ? "Connecting" : "Disconnected";
  return (
    <output className="flex items-center gap-1.5" aria-live="polite">
      <span className={`size-2 rounded-full ${dot}`} aria-hidden="true" />
      <span className="text-[10px] text-kumo-inactive">{label}</span>
    </output>
  );
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => (part as { type: "text"; text: string }).text)
    .join("");
}

function formatToolPayload(value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  return json.length > 3000 ? `${json.slice(0, 3000)}\n… truncated` : json;
}

/** Text and reasoning parts use `state: streaming` with empty `text` until the first delta. */
function shouldShowStreamedTextPart(part: { text: string; state?: "streaming" | "done" }): boolean {
  return part.text.length > 0 || part.state === "streaming";
}

export function ChatPanel({
  agent,
  connectionStatus,
  onChatSummary,
}: {
  agent: AgentConnection;
  connectionStatus: ConnectionStatus;
  onChatSummary?: (summary: string) => void;
}) {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, clearHistory, stop, status } = useAgentChat({
    agent,
    experimental_throttle: 100,
  });

  const isStreaming = status === "streaming" || status === "submitted";
  const isConnected = connectionStatus === "connected";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const chatSummary = useMemo(() => {
    const lines = messages
      .slice(-8)
      .map((message) => {
        const text = getMessageText(message).trim().replace(/\s+/g, " ");
        if (!text) return "";
        return `${message.role}: ${text}`;
      })
      .filter(Boolean);
    return lines.length > 0 ? `Recent chat: ${lines.join(" / ").slice(0, 600)}` : "";
  }, [messages]);

  useEffect(() => {
    if (chatSummary) onChatSummary?.(chatSummary);
  }, [chatSummary, onChatSummary]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    sendMessage({ role: "user", parts: [{ type: "text", text }] });
  }, [input, isStreaming, sendMessage]);

  return (
    <aside className="w-[380px] shrink-0 flex flex-col h-full border-l border-kumo-line bg-kumo-base">
      <div className="px-4 py-3 border-b border-kumo-line flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RobotIcon size={16} weight="bold" className="text-kumo-accent" />
          <Text size="sm" bold>
            Assistant
          </Text>
          <ConnectionIndicator status={connectionStatus} />
        </div>
        <Button
          variant="ghost"
          shape="square"
          aria-label="Clear conversation"
          icon={<TrashIcon size={16} />}
          onClick={() => clearHistory()}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <Empty
            icon={<RobotIcon size={28} />}
            title="Talk to your studio"
            description="Try “give me a dreamy progression in D”, “make it sadder”, “up a step”, or “play it.”"
          />
        )}

        {messages.map((message, index) => {
          const isUser = message.role === "user";
          const isLastAssistant = message.role === "assistant" && index === messages.length - 1;

          if (isUser) {
            return (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-[90%] px-3.5 py-2 rounded-2xl rounded-br-md bg-kumo-contrast text-kumo-inverse text-sm leading-relaxed">
                  {getMessageText(message)}
                </div>
              </div>
            );
          }

          return (
            <div key={message.id} className="space-y-2">
              {message.parts.map((part, partIndex) => {
                if (part.type === "text") {
                  if (!shouldShowStreamedTextPart(part)) return null;
                  const isLastTextPart = message.parts
                    .slice(partIndex + 1)
                    .every((p) => p.type !== "text");
                  return (
                    <div key={partIndex} className="flex justify-start">
                      <div className="max-w-[90%] px-3.5 py-2 rounded-2xl rounded-bl-md bg-kumo-elevated text-kumo-default text-sm leading-relaxed">
                        <Streamdown
                          className="sd-theme min-h-[1.25em]"
                          plugins={{ code }}
                          controls={false}
                          isAnimating={isLastAssistant && isLastTextPart && isStreaming}
                        >
                          {part.text}
                        </Streamdown>
                      </div>
                    </div>
                  );
                }

                if (part.type === "reasoning") {
                  if (!shouldShowStreamedTextPart(part)) return null;
                  return (
                    <div key={partIndex} className="flex justify-start">
                      <Surface className="max-w-[90%] px-3.5 py-2 rounded-xl ring ring-kumo-line opacity-70">
                        <div className="whitespace-pre-wrap text-xs text-kumo-subtle italic min-h-[1em]">
                          {part.text || (part.state === "streaming" ? "…" : null)}
                        </div>
                      </Surface>
                    </div>
                  );
                }

                if (!isToolUIPart(part)) return null;
                const toolName = getToolName(part);
                const toolInput = part.input as Record<string, unknown> | undefined;
                const toolOutput = (part as { output?: unknown }).output;
                const errorText = (part as { errorText?: string }).errorText;

                const isRunning =
                  part.state === "input-available" || part.state === "input-streaming";
                const isDone = part.state === "output-available";
                const isError = part.state === "output-error";

                return (
                  <div key={part.toolCallId} className="flex justify-start">
                    <Surface className="max-w-[90%] px-3.5 py-2 rounded-xl ring ring-kumo-line overflow-hidden">
                      <div className="flex items-center gap-2 mb-1">
                        {isError ? (
                          <XCircleIcon size={14} className="text-kumo-inactive" />
                        ) : (
                          <GearIcon
                            size={14}
                            className={`text-kumo-inactive ${isRunning ? "animate-spin" : ""}`}
                          />
                        )}
                        <Text size="xs" variant="secondary" bold>
                          {isRunning ? `Running ${toolName}…` : toolName}
                        </Text>
                        {isDone && <Badge variant="secondary">Done</Badge>}
                        {isError && <Badge variant="destructive">Error</Badge>}
                      </div>
                      {toolInput != null && (
                        <pre className="mt-1 p-2 rounded-lg bg-kumo-elevated text-xs font-mono text-kumo-subtle overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                          {formatToolPayload(toolInput)}
                        </pre>
                      )}
                      {errorText && (
                        <pre className="mt-1 p-2 rounded-lg bg-red-50 dark:bg-red-950/20 text-xs font-mono text-red-600 dark:text-red-400 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                          {errorText}
                        </pre>
                      )}
                      {toolOutput != null && (
                        <pre className="mt-1 p-2 rounded-lg bg-kumo-elevated text-xs font-mono text-kumo-subtle overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-all">
                          {formatToolPayload(toolOutput)}
                        </pre>
                      )}
                    </Surface>
                  </div>
                );
              })}
            </div>
          );
        })}

        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="px-4 py-3 border-t border-kumo-line"
      >
        <div className="flex items-end gap-2 rounded-xl border border-kumo-line bg-kumo-base p-2 focus-within:ring-2 focus-within:ring-kumo-ring focus-within:border-transparent transition-shadow">
          <InputArea
            value={input}
            onValueChange={setInput}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask your studio…"
            disabled={!isConnected || isStreaming}
            rows={2}
            className="flex-1 ring-0! focus:ring-0! shadow-none! bg-transparent! outline-none!"
          />
          {isStreaming ? (
            <Button
              type="button"
              variant="secondary"
              shape="square"
              aria-label="Stop streaming"
              onClick={stop}
              icon={<StopIcon size={18} weight="fill" />}
            />
          ) : (
            <Button
              type="submit"
              variant="primary"
              shape="square"
              aria-label="Send message"
              disabled={!input.trim() || !isConnected}
              icon={<PaperPlaneRightIcon size={18} />}
            />
          )}
        </div>
      </form>
    </aside>
  );
}
