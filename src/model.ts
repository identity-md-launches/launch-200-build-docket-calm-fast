import { decodeEventLog, parseAbi, type Address, type Hex } from "viem";
export const abi = parseAbi([
  "function createIdea(string title, string body) returns (uint256 ideaId)",
  "function comment(uint256 ideaId, string body) returns (uint256 commentId)",
  "function upvote(uint256 ideaId, uint256 commentId)",
  "function ideaCount() view returns (uint256)",
  "function commentCount(uint256 ideaId) view returns (uint256)",
  "function upvotes(uint256 ideaId, uint256 commentId) view returns (uint256)",
  "function hasUpvoted(uint256 ideaId, uint256 commentId, address voter) view returns (bool)",
  "event IdeaCreated(uint256 indexed ideaId, address indexed author, string title, string body)",
  "event CommentPosted(uint256 indexed ideaId, uint256 indexed commentId, address indexed author, string body)",
  "event Upvoted(uint256 indexed ideaId, uint256 indexed commentId, address indexed voter)",
  "error BadLength()",
  "error UnknownIdea()",
  "error UnknownComment()",
  "error AlreadyUpvoted()",
]);
export interface EventRecord {
  blockNumber: string;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
  transactionIndex: number;
  topics: Hex[];
  data: Hex;
  time: number;
}
export interface Comment {
  id: string;
  author: Address;
  body: string;
  time: number;
  voters: Address[];
}
export interface Idea extends Comment {
  chainId: number;
  title: string;
  subject?: string;
  comments: Comment[];
}
export const bytes = (s: string) => new TextEncoder().encode(s).length;
export const subjectPattern =
  /^(?:(?:job|oracle):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?:launch|agent):[0-9]+)$/i;
export const normalizeSubject = (s: string) => {
  const v = s.trim().toLowerCase();
  if (!subjectPattern.test(v)) return undefined;
  const [kind, id] = v.split(":");
  return `${kind}:${kind === "agent" || kind === "launch" ? BigInt(id).toString() : id}`;
};
export function parseSubject(body: string) {
  const end = body.indexOf("\n");
  const line = end < 0 ? body : body.slice(0, end);
  const ref = line.startsWith("subject: ")
    ? normalizeSubject(line.slice(9))
    : undefined;
  return ref
    ? { subject: ref, body: end < 0 ? "" : body.slice(end + 1) }
    : { body };
}
export function subjectUrl(ref: string) {
  const [kind, id] = ref.split(":");
  return `https://explorer.imd.fun/${({ job: "jobs", launch: "launches", agent: "agents", oracle: "oracle" } as Record<string, string>)[kind]}/${encodeURIComponent(id)}`;
}
export const subjectLabel = (ref: string, short = false) => {
  const [kind, id] = ref.split(":");
  return `on ${kind} ${short && id.length > 12 ? id.slice(0, 8) + "…" : id}`;
};
export const keyOf = (i: Idea) => `${i.chainId}/${i.id}`;
export function replay(records: EventRecord[], chainId: number): Idea[] {
  const ideas = new Map<string, Idea>();
  const seen = new Set<string>();
  const sorted = [...records].sort((a, b) =>
    BigInt(a.blockNumber) < BigInt(b.blockNumber)
      ? -1
      : BigInt(a.blockNumber) > BigInt(b.blockNumber)
        ? 1
        : a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex,
  );
  for (const r of sorted) {
    const identity = `${r.blockHash}/${r.transactionHash}/${r.logIndex}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const e = decodeEventLog({
      abi,
      data: r.data,
      topics: r.topics as [Hex, ...Hex[]],
    });
    const args = e.args;
    const id = args.ideaId.toString();
    if (e.eventName === "IdeaCreated") {
      if (BigInt(id) !== BigInt(ideas.size) + 1n)
        throw new Error("Incomplete idea history. Retry to rescan.");
      const parsed = parseSubject(e.args.body);
      ideas.set(id, {
        id,
        chainId,
        author: e.args.author,
        title: e.args.title,
        ...parsed,
        time: r.time,
        voters: [],
        comments: [],
      });
    } else {
      const idea = ideas.get(id);
      if (!idea) throw new Error("Incomplete idea history. Retry to rescan.");
      if (e.eventName === "CommentPosted") {
        if (e.args.commentId !== BigInt(idea.comments.length) + 1n)
          throw new Error("Incomplete comment history. Retry to rescan.");
        idea.comments.push({
          id: e.args.commentId.toString(),
          author: e.args.author,
          body: e.args.body,
          time: r.time,
          voters: [],
        });
      } else {
        const target =
          e.args.commentId === 0n
            ? idea
            : idea.comments.find((c) => c.id === e.args.commentId.toString());
        if (
          !target ||
          target.voters.some(
            (v) => v.toLowerCase() === e.args.voter.toLowerCase(),
          )
        )
          throw new Error("Incomplete vote history. Retry to rescan.");
        target.voters.push(e.args.voter);
      }
    }
  }
  return [...ideas.values()];
}
export function shortAddress(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
export function readableError(error: unknown): string {
  const e = error as { shortMessage?: string; message?: string };
  const text = e.shortMessage || e.message || "The request failed.";
  if (/reject|denied/i.test(text))
    return "Transaction declined. Your text is still here; try again when ready.";
  if (/AlreadyUpvoted/.test(text))
    return "This wallet has already upvoted. Refresh the board to see its vote.";
  return text.slice(0, 240) + " Try again.";
}
