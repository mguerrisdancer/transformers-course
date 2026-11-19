const chatLog = document.querySelector("#chatLog");
const chatForm = document.querySelector("#chatForm");
const messageInput = document.querySelector("#messageInput");
const sendButton = document.querySelector("#sendButton");
const clearButton = document.querySelector("#clearButton");
const contextView = document.querySelector("#contextView");
const usageSummary = document.querySelector("#usageSummary");

let messages = [];
let visibleMessages = [];
let turns = [];

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function renderMarkdown(markdown) {
  const blocks = [];
  const codePattern = /```([\w-]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match;

  while ((match = codePattern.exec(markdown)) !== null) {
    blocks.push({ type: "text", value: markdown.slice(cursor, match.index) });
    blocks.push({ type: "code", language: match[1], value: match[2] });
    cursor = match.index + match[0].length;
  }
  const remaining = markdown.slice(cursor);
  const openFence = remaining.match(/```([\w-]*)\n?/);
  if (openFence) {
    blocks.push({ type: "text", value: remaining.slice(0, openFence.index) });
    blocks.push({ type: "code", language: openFence[1], value: remaining.slice(openFence.index + openFence[0].length) });
  } else {
    blocks.push({ type: "text", value: remaining });
  }

  return blocks
    .map((block) => {
      if (block.type === "code") {
        return `<pre><code>${escapeHtml(block.value.trim())}</code></pre>`;
      }

      const lines = block.value.split("\n");
      const html = [];
      let listItems = [];
      let listType = "ul";

      function flushList() {
        if (listItems.length > 0) {
          html.push(`<${listType}>${listItems.map((item) => `<li>${item}</li>`).join("")}</${listType}>`);
          listItems = [];
        }
      }

      function addListItem(type, item) {
        if (listItems.length > 0 && listType !== type) flushList();
        listType = type;
        listItems.push(item);
      }

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const trimmed = line.trim();
        if (!trimmed) {
          const nextLine = lines.slice(index + 1).find((item) => item.trim());
          const nextListType = nextLine?.trim().match(/^[-*]\s+/) ? "ul" : nextLine?.trim().match(/^\d+\.\s+/) ? "ol" : null;
          if (listItems.length > 0 && listType === nextListType) continue;
          flushList();
          continue;
        }

        const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
          flushList();
          const level = heading[1].length;
          html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
          continue;
        }

        const list = trimmed.match(/^[-*]\s+(.+)$/);
        if (list) {
          addListItem("ul", renderInlineMarkdown(list[1]));
          continue;
        }

        const orderedList = trimmed.match(/^\d+\.\s+(.+)$/);
        if (orderedList) {
          addListItem("ol", renderInlineMarkdown(orderedList[1]));
          continue;
        }

        flushList();
        html.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
      }

      flushList();
      return html.join("");
    })
    .join("");
}

function renderChat() {
  if (visibleMessages.length === 0) {
    chatLog.innerHTML = '<div class="empty-state">Start a conversation. Replies render as Markdown.</div>';
    return;
  }

  chatLog.innerHTML = visibleMessages
    .map(
      (message) => `
        <article class="message ${message.role}">
          <div class="message-label">${message.role}</div>
          <div class="bubble">${renderMarkdown(message.content)}</div>
        </article>
      `,
    )
    .join("");
  chatLog.scrollTop = chatLog.scrollHeight;
}

function renderContext() {
  contextView.textContent = JSON.stringify(turns, null, 2);

  const latestUsage = turns.at(-1)?.usage;
  if (!latestUsage) {
    usageSummary.textContent = turns.length === 0 ? "No requests yet." : "No token usage returned.";
    return;
  }

  usageSummary.textContent = [
    `Prompt: ${latestUsage.prompt_tokens ?? "?"}`,
    `Completion: ${latestUsage.completion_tokens ?? "?"}`,
    `Total: ${latestUsage.total_tokens ?? "?"}`,
  ].join(" | ");
}

function setLoading(isLoading) {
  sendButton.disabled = isLoading;
  messageInput.disabled = isLoading;
  sendButton.textContent = isLoading ? "Sending..." : "Send";
}

function parseSseFrame(frame) {
  const lines = frame.split("\n");
  const event = lines.find((line) => line.startsWith("event: "))?.slice(7) || "message";
  const data = lines
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6))
    .join("\n");

  return { event, data: data ? JSON.parse(data) : {} };
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const content = messageInput.value.trim();
  if (!content) return;

  const userMessage = { role: "user", content };
  messages.push(userMessage);
  visibleMessages.push(userMessage);
  messageInput.value = "";
  renderChat();
  setLoading(true);

  let assistantMessage;

  try {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`HTTP ${response.status}: ${responseText || response.statusText}`);
    }

    assistantMessage = { role: "assistant", content: "" };
    visibleMessages.push(assistantMessage);
    renderChat();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage = null;
    let messagesSent = null;

    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop();

      for (const frame of frames) {
        if (!frame.trim()) continue;
        const streamEvent = parseSseFrame(frame);

        if (streamEvent.event === "token") {
          assistantMessage.content += streamEvent.data.content || "";
          renderChat();
        } else if (streamEvent.event === "usage") {
          usage = streamEvent.data;
        } else if (streamEvent.event === "done") {
          messagesSent = streamEvent.data.messages_sent;
        } else if (streamEvent.event === "error") {
          throw new Error(streamEvent.data.detail || "Streaming request failed");
        }
      }

      if (done) break;
    }

    if (!messagesSent) {
      throw new Error("Stream ended before completion.");
    }

    messages.push(assistantMessage);
    turns.push({ messages_sent: messagesSent, usage });
    renderChat();
    renderContext();
  } catch (error) {
    if (assistantMessage && !assistantMessage.content) {
      visibleMessages = visibleMessages.filter((message) => message !== assistantMessage);
    }
    visibleMessages.push({ role: "error", content: error.message });
    renderChat();
  } finally {
    setLoading(false);
    messageInput.focus();
  }
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

clearButton.addEventListener("click", () => {
  messages = [];
  visibleMessages = [];
  turns = [];
  renderChat();
  renderContext();
  messageInput.focus();
});

renderChat();
renderContext();
