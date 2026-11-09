"use strict";
(function registerAiAssistantUi(global) {
    function createAiAssistantUi(deps) {
        const {
            $,
            api,
            toast,
            busy,
            document,
            window,
            navigator,
            setTimeout,
            getCurrentUser,
            getCurrentSectionName,
            console
        } = deps;
        // Handles the XTECH AI chat and each user's saved history
        const CHAT_GREETING =
            "Hello! I’m the XTECH Help Assistant. I can guide you through the page you’re viewing or answer questions about XTECH features.";
        let chatHistoryLoadedForUid = null;
        let aiRequestInProgress = false;

        const AI_SECTION_LABELS = {
            dashboard: "Dashboard",
            inventory: "Inventory Management",
            transactions: "Stock Movement History",
            customers: "Customer Management",
            pickups: "Pickup Services",
            sales: "Sales Transactions",
            users: "User Accounts",
            reports: "Reports",
            profile: "My Profile",
            security: "Account & Security"
        };

        const AI_PAGE_SUGGESTIONS = {
            dashboard: [
                "What does this dashboard show?",
                "What should I check when a product needs attention?",
                "What can I do on this page?"
            ],
            inventory: [
                "How do I add a product?",
                "How do I Stock In or Stock Out?",
                "Why can't I edit quantity directly?"
            ],
            transactions: [
                "What does Stock Movement History show?",
                "How do I find a stock change?",
                "What do the movement types mean?"
            ],
            customers: [
                "How do I edit a customer?",
                "How do I deactivate or activate a customer?",
                "How do I view customer history?"
            ],
            pickups: [
                "How do pickup requests work?",
                "Why can a pickup request be blocked?",
                "When does a pickup deduct stock?"
            ],
            sales: [
                "How do I record a sale?",
                "What happens if there is not enough stock?",
                "How are sold quantities recorded?"
            ],
            users: [
                "How do I create a staff account?",
                "Which staff roles can I create?",
                "What can each role access?"
            ],
            reports: [
                "How do I save a report as PDF?",
                "How do I export the selected report as CSV?",
                "What is included in the printed report?"
            ],
            profile: [
                "How do I update my profile?",
                "Why can't I change my email here?",
                "What profile information can I edit?"
            ],
            security: [
                "How do I change my password?",
                "What if I forgot my password?",
                "How does Email OTP sign-in work?"
            ]
        };

        // Updates the AI header with the page the user is currently viewing.
        function updateAiContextLabel() {
            const label = $("aiContextLabel");
            if (!label) return;
            label.textContent = `Viewing: ${AI_SECTION_LABELS[getCurrentSectionName()] || "XTECH Automation"}`;
        }

        // Shows quick questions that match the currently visible XTECH page.
        function renderAiQuickActions() {
            const container = $("aiQuickActions");
            if (!container) return;

            const suggestions = AI_PAGE_SUGGESTIONS[getCurrentSectionName()] || [
                "What can I do on this page?"
            ];
            container.innerHTML = "";

            for (const question of suggestions) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "ai-suggestion-chip";
                button.textContent = question;
                button.addEventListener("click", () => {
                    const input = $("chatInput");
                    if (!input) return;
                    input.value = question;
                    $("chatForm")?.requestSubmit();
                });
                container.appendChild(button);
            }
        }

        // Prevents multiple AI requests from being sent at the same time.
        function setAiQuickActionsDisabled(disabled) {
            document.querySelectorAll(".ai-suggestion-chip").forEach((button) => {
                button.disabled = disabled;
            });
        }

        // Copies an AI answer without copying message labels or interface controls.
        async function copyAiAnswer(text, button) {
            const value = String(text || "");
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(value);
                } else {
                    const area = document.createElement("textarea");
                    area.value = value;
                    area.style.position = "fixed";
                    area.style.opacity = "0";
                    document.body.appendChild(area);
                    area.select();
                    document.execCommand("copy");
                    area.remove();
                }

                const original = button.textContent;
                button.textContent = "Copied";
                setTimeout(() => {
                    if (button.isConnected) button.textContent = original;
                }, 1200);
            } catch {
                toast("Unable to copy the AI answer");
            }
        }

        // Converts common Markdown into safe HTML for AI answers
        function renderAssistantMarkdown(value) {
            const escapeHtml = (text) =>
                String(text ?? "").replace(
                    /[&<>"']/g,
                    (char) =>
                        ({
                            "&": "&amp;",
                            "<": "&lt;",
                            ">": "&gt;",
                            '"': "&quot;",
                            "'": "&#039;"
                        })[char]
                );

            const formatInline = (value) => {
                let text = escapeHtml(value);

                // Formats the Markdown styles used in XTECH AI responses.
                text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
                text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
                text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
                text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");
                text = text.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,!?;:])/g, "$1<em>$2</em>");
                text = text.replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?;:])/g, "$1<em>$2</em>");
                return text;
            };

            const lines = String(value ?? "")
                .replace(/\r\n/g, "\n")
                .split("\n");
            const output = [];
            let listType = null;

            const closeList = () => {
                if (!listType) return;
                output.push(`</${listType}>`);
                listType = null;
            };

            for (const originalLine of lines) {
                const line = originalLine.trim();

                if (!line) {
                    closeList();
                    continue;
                }

                // Converts Markdown separators into a subtle divider.
                if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
                    closeList();
                    output.push('<hr class="ai-divider">');
                    continue;
                }

                // Supports normal Markdown headings without showing the # characters.
                const heading = line.match(/^(#{1,6})\s+(.+)$/);
                if (heading) {
                    closeList();
                    const level = Math.min(5, heading[1].length + 1);
                    output.push(`<h${level}>${formatInline(heading[2])}</h${level}>`);
                    continue;
                }

                // Supports numbered Markdown lists such as "1. Item" and "1) Item".
                const ordered = line.match(/^\d+[.)]\s+(.+)$/);
                if (ordered) {
                    if (listType !== "ol") {
                        closeList();
                        listType = "ol";
                        output.push("<ol>");
                    }
                    output.push(`<li>${formatInline(ordered[1])}</li>`);
                    continue;
                }

                // Supports *, -, +, and • as Markdown bullet markers.
                const unordered = line.match(/^(?:[-+*•])\s+(.+)$/);
                if (unordered) {
                    if (listType !== "ul") {
                        closeList();
                        listType = "ul";
                        output.push("<ul>");
                    }
                    output.push(`<li>${formatInline(unordered[1])}</li>`);
                    continue;
                }

                closeList();

                // Turns short Note/Tip/Warning lines into a highlighted callout.
                const noteText = line.replace(/^\*(?!\s)/, "").replace(/\*$/, "");
                if (/^(note|important|tip|warning):/i.test(noteText)) {
                    output.push(`<div class="ai-note">${formatInline(noteText)}</div>`);
                    continue;
                }

                output.push(`<p>${formatInline(line)}</p>`);
            }

            closeList();
            return output.join("");
        }

        // Adds a message bubble to the AI chat
        function addChatMessage(text, who = "assistant") {
            const messages = $("chatMessages");
            if (!messages) return;

            const row = document.createElement("div");
            row.className = `chat-message ${who}`;

            if (who === "assistant") {
                const avatar = document.createElement("div");
                avatar.className = "chat-avatar";
                avatar.textContent = "✦";
                avatar.setAttribute("aria-hidden", "true");
                row.appendChild(avatar);
            }

            const content = document.createElement("div");
            content.className = "chat-message-content";

            const meta = document.createElement("div");
            meta.className = "chat-message-meta";

            const label = document.createElement("div");
            label.className = "chat-message-label";
            label.textContent = who === "assistant" ? "XTECH AI" : "You";
            meta.appendChild(label);

            if (who === "assistant") {
                const copyButton = document.createElement("button");
                copyButton.type = "button";
                copyButton.className = "chat-copy-btn";
                copyButton.textContent = "Copy";
                copyButton.addEventListener("click", () => copyAiAnswer(text, copyButton));
                meta.appendChild(copyButton);
            }

            const bubble = document.createElement("div");
            bubble.className = "chat-bubble";

            if (who === "assistant") {
                bubble.innerHTML = renderAssistantMarkdown(text);
            } else {
                bubble.textContent = text;
            }

            content.appendChild(meta);
            content.appendChild(bubble);
            row.appendChild(content);
            messages.appendChild(row);
            messages.scrollTop = messages.scrollHeight;
        }

        // Shows a small typing indicator while the assistant is generating a response.
        function showAiTyping() {
            if ($("aiTypingIndicator")) return;
            const messages = $("chatMessages");
            if (!messages) return;

            const row = document.createElement("div");
            row.id = "aiTypingIndicator";
            row.className = "chat-message assistant";
            row.innerHTML = `
        <div class="chat-avatar" aria-hidden="true">✦</div>
        <div class="chat-message-content">
            <div class="chat-message-meta"><div class="chat-message-label">XTECH AI</div></div>
            <div class="chat-bubble ai-typing-bubble" aria-label="XTECH AI is typing">
                <span></span><span></span><span></span>
            </div>
        </div>`;
            messages.appendChild(row);
            messages.scrollTop = messages.scrollHeight;
        }

        function hideAiTyping() {
            $("aiTypingIndicator")?.remove();
        }

        // Clears the visible chat and shows the greeting
        function resetChatPanel() {
            chatHistoryLoadedForUid = null;
            const panel = $("aiChatPanel");
            if (panel) panel.classList.add("hidden");
            const messages = $("chatMessages");
            if (!messages) return;
            messages.innerHTML = "";
            addChatMessage(CHAT_GREETING, "assistant");
        }

        // Loads the signed-in user's saved AI chat history
        async function loadChatHistory(force = false) {
            const uid = getCurrentUser()?.uid;
            if (!uid || !$("chatMessages")) return;
            if (!force && chatHistoryLoadedForUid === uid) return;

            try {
                const result = await api("/api/chat/history", { silent: true });
                const messages = $("chatMessages");
                messages.innerHTML = "";

                if (!Array.isArray(result.messages) || result.messages.length === 0) {
                    addChatMessage(CHAT_GREETING, "assistant");
                } else {
                    for (const item of result.messages) {
                        const who = item.role === "user" ? "user" : "assistant";
                        addChatMessage(String(item.text || ""), who);
                    }
                }

                chatHistoryLoadedForUid = uid;
            } catch (error) {
                resetChatPanel();
                addChatMessage(
                    "I couldn't load your saved conversation history, but you can still start a new chat.",
                    "assistant"
                );
                console.error("Chat history load failed:", error);
            }
        }

        // Opens the floating AI Help Assistant popup
        $("aiBubble")?.addEventListener("click", async () => {
            const panel = $("aiChatPanel");
            if (!panel) return;

            const opening = panel.classList.contains("hidden");
            panel.classList.toggle("hidden", !opening);

            if (opening) {
                updateAiContextLabel();
                renderAiQuickActions();
                await loadChatHistory();
                $("chatInput")?.focus();
            }
        });

        // Closes the floating AI Help Assistant popup
        $("closeAiChat")?.addEventListener("click", () => {
            $("aiChatPanel")?.classList.add("hidden");
        });

        // Closes the AI popup when Escape is pressed
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") $("aiChatPanel")?.classList.add("hidden");
        });

        $("chatForm")?.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (aiRequestInProgress) return;

            const input = $("chatInput");
            const question = input.value.trim();
            if (!question) return;

            aiRequestInProgress = true;
            setAiQuickActionsDisabled(true);
            addChatMessage(question, "user");
            input.value = "";
            showAiTyping();

            try {
                const result = await busy(
                    $("chatSend"),
                    () =>
                        api("/api/chat", {
                            method: "POST",
                            body: JSON.stringify({
                                message: question,
                                section: getCurrentSectionName()
                            }),
                            silent: true
                        }),
                    "Thinking…"
                );
                addChatMessage(result.reply || "I couldn't produce an answer.", "assistant");
                chatHistoryLoadedForUid = getCurrentUser()?.uid || null;
            } catch (error) {
                addChatMessage(
                    error.message || "The XTECH Help Assistant is unavailable.",
                    "assistant"
                );
            } finally {
                hideAiTyping();
                aiRequestInProgress = false;
                setAiQuickActionsDisabled(false);
            }
        });

        $("chatInput")?.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                $("chatForm")?.requestSubmit();
            }
        });

        $("clearChat")?.addEventListener("click", async () => {
            if (!getCurrentUser()) return;
            if (
                !window.confirm(
                    "Clear your saved AI conversation history? This only clears the current user's chat."
                )
            )
                return;

            try {
                await busy(
                    $("clearChat"),
                    () =>
                        api("/api/chat/history", {
                            method: "DELETE"
                        }),
                    "Clearing…"
                );
                resetChatPanel();
                chatHistoryLoadedForUid = getCurrentUser().uid;
                toast("Your AI chat history was cleared");
            } catch (error) {
                toast(error.message || "Unable to clear chat history");
            }
        });

        return Object.freeze({
            updateAiContextLabel,
            renderAiQuickActions,
            resetChatPanel,
            loadChatHistory,
            renderAssistantMarkdown,
            addChatMessage
        });
    }
    global.XTechAiAssistantUi = Object.freeze({ createAiAssistantUi });
})(typeof window !== "undefined" ? window : globalThis);
