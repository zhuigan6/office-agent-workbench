type Message = { id?: string; msg_id?: string; [key: string]: any };
type Page = { items?: Message[]; messages?: Message[]; oldest_cursor?: string; has_more_before?: boolean };
type Ticket = { generation: number; sequence: number; older: boolean; cursor: string };

// Keep one chronological window; polling must not reset the oldest loaded cursor.
export class HistoryWindow {
  private conversation = '';
  private generation = 0;
  private sequence = 0;
  private applied = 0;
  private initialized = false;
  private loadingOlder = false;
  items: Message[] = [];
  cursor = '';
  hasOlder = false;
  select(id: string) {
    if (id === this.conversation) return;
    this.conversation = id;
    this.generation++;
    this.items = [];
    this.cursor = '';
    this.hasOlder = this.initialized = this.loadingOlder = false;
    this.applied = 0;
  }
  begin(older = false): Ticket | undefined {
    if (older && (!this.hasOlder || !this.cursor || this.loadingOlder)) return;
    if (older) this.loadingOlder = true;
    return { generation: this.generation, sequence: ++this.sequence, older, cursor: this.cursor };
  }
  fail(ticket: Ticket) {
    if (ticket.generation === this.generation && ticket.older) this.loadingOlder = false;
  }
  apply(ticket: Ticket, page: Page | Message[]): boolean {
    if (ticket.generation !== this.generation) return false;
    if (!ticket.older && ticket.sequence < this.applied) return false;
    const entries = Array.isArray(page) ? page : page.items || page.messages || [];
    const merged = ticket.older ? [...entries, ...this.items] : [...this.items, ...entries];
    const keyed = new Map<string, Message>();
    merged.forEach((message, i) => keyed.set(message.id || message.msg_id || `unkeyed-${i}`, message));
    this.items = [...keyed.values()];
    if (ticket.older || !this.initialized) {
      const cursor = !Array.isArray(page) ? page.oldest_cursor || '' : '';
      this.hasOlder = !Array.isArray(page) && Boolean(page.has_more_before) && Boolean(cursor)
        && (!ticket.older || cursor !== ticket.cursor);
      this.cursor = cursor;
      this.initialized = true;
    }
    if (ticket.older) this.loadingOlder = false;
    else this.applied = ticket.sequence;
    return true;
  }
}
