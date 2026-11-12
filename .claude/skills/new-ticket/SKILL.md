---
name: new-ticket
description: Turn a sentence into a well-formed GitHub issue for this repo — outcome title, body, Type, priority, scope and links — after checking for duplicates, and create it only once the person confirms. Use when someone wants to file, open, start or jot down a ticket, issue, bug or idea, e.g. "/new-ticket cars should sink in the lake".
---

# New ticket

The rules are the **Tickets** section of `AGENTS.md`. Read it first and follow it; don't restate it here or invent rules it doesn't have.

1. **Understand the idea.** If the sentence leaves the outcome unclear, ask one short question. Otherwise go on: a small idea doesn't need an interview.
2. **Look for duplicates and neighbours.** Search open and closed issues by the idea's key words (`gh issue list --repo OliverRomhagen/vrigstad-joyride --state all --search "<words>" --json number,title,state,issueType,labels`), and try a synonym or two. If one already covers it, say so and stop. That issue may want a comment rather than a twin.
3. **Draft:**
   - a title that states the outcome ("Cars sink when driven into deep water", not "Water");
   - a body in the shape of the matching form in `.github/ISSUE_TEMPLATE/`: what the player gets, or the problem, and then "Done when";
   - a Type (`Bug`, `Feature` or `Task`), a priority, and at most one scope, following AGENTS.md. Compare with how similar issues are ranked, and say the priority is a proposal;
   - links: "blocked by" for an issue this can't start without, a parent for a tracking issue it belongs to, and plain `#n` mentions for related ones.
4. **Show the draft and wait.** Print the title, labels, Type, links and body, and ask for a yes or for changes. Create nothing before the person confirms.
5. **Create and link:**
   ```
   gh issue create --repo OliverRomhagen/vrigstad-joyride --type <Type> --label <prio> --label <scope> --title "<title>" --body-file <file>
   gh issue edit <n> --repo OliverRomhagen/vrigstad-joyride --add-blocked-by <m>        # if any
   gh issue edit <parent> --repo OliverRomhagen/vrigstad-joyride --add-sub-issue <n>    # if any
   ```
   Then reply with the new issue's link.
