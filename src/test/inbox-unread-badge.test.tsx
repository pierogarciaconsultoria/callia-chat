import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ count: { data: 0 as number | undefined } }));
vi.mock("@/hooks/use-inbox-unread", () => ({ useInboxUnreadCount: () => mocks.count }));

import { InboxUnreadBadge } from "@/components/InboxUnreadBadge";

describe("selo de não lidas ao lado de Inbox", () => {
  afterEach(cleanup);

  it("some sem não lidas, mostra a quantidade e limita em 99+", () => {
    mocks.count.data = 0;
    const { container } = render(<InboxUnreadBadge workspaceId="w1" />);
    expect(container.textContent).toBe("");
    cleanup();
    mocks.count.data = 3;
    render(<InboxUnreadBadge workspaceId="w1" />);
    expect(screen.getByLabelText("3 conversa(s) com mensagens não lidas").textContent).toBe("3");
    cleanup();
    mocks.count.data = 140;
    render(<InboxUnreadBadge workspaceId="w1" />);
    expect(screen.getByLabelText("140 conversa(s) com mensagens não lidas").textContent).toBe("99+");
  });
});
