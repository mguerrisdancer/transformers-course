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
  blocks.push({ type: "text", value: markdown.slice(cursor) });

  return blocks
    .map((block) => {
      if (block.type === "code") {
        return `<pre><code>${escapeHtml(block.value.trim())}</code></pre>`;
      }

      const lines = block.value.split("\n");
      const html = [];
      let listItems = [];

      function flushList() {
        if (listItems.length > 0) {
          html.push(`<ul>${listItems.map((item) => `<li>${item}</li>`).join("")}</ul>`);
          listItems = [];
        }
      }

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
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
          listItems.push(renderInlineMarkdown(list[1]));
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

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "Request failed");
    }

    const assistantMessage = { role: "assistant", content: data.answer };
    messages.push(assistantMessage);
    visibleMessages.push(assistantMessage);
    turns.push({ messages_sent: data.messages_sent, usage: data.usage });
    renderChat();
    renderContext();
  } catch (error) {
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
