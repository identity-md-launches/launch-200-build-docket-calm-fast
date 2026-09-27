import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { decodeEventLog, type Address, type Hex } from "viem";
import { chainName, clientFor, type Config } from "./config";
import { useBoards, type BoardState } from "./reader";
import { useBadges, balanceText, type Badge } from "./badges";
import { useWallet, type Wallet } from "./wallet";
import {
  abi,
  bytes,
  keyOf,
  normalizeSubject,
  readableError,
  shortAddress,
  subjectLabel,
  subjectUrl,
  type Idea,
  type Comment,
} from "./model";
import artifact from "./docket.json";
interface Context {
  config: Config;
  wallet: Wallet;
  badges: Record<string, Badge>;
  retryBadges: () => void;
  states: BoardState[];
  refresh: (id?: number) => Promise<void>;
  openWallet: () => void;
}
const Context = createContext<Context>(null!);
const useDocket = () => useContext(Context);
function useRoute() {
  const [route, setRoute] = useState(location.hash.slice(1) || "/");
  useEffect(() => {
    const onHash = () => {
      if (location.hash === "#main") return;
      setRoute(location.hash.slice(1) || "/");
      requestAnimationFrame(() => {
        document
          .getElementById(
            location.hash === "#/"
              ? "ideas-heading"
              : location.hash.startsWith("#/s/")
                ? "subject-heading"
                : "view-heading",
          )
          ?.focus();
      });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}
const commentCount = (n: number) => `${n} ${n === 1 ? "comment" : "comments"}`;
const go = (path: string) => {
  location.hash = path;
};
function SmallLabel({ children }: { children: ReactNode }) {
  return <span className="eyebrow">{children}</span>;
}
function Author({ address }: { address: Address }) {
  const { badges, config, retryBadges } = useDocket();
  const b = badges[address.toLowerCase()];
  return (
    <span className="author">
      <bdi title={address}>{b?.name || shortAddress(address)}</bdi>
      {b?.error ? (
        <button className="text-button" onClick={retryBadges}>
          retry badges
        </button>
      ) : b ? (
        <span className="badges">
          <span title={`${b.seats} identitymd seats`}>
            {b.seats.toString()} seats
          </span>
          <span title={`${balanceText(b.imd, config.gate.imdDecimals)} IMD`}>
            {balanceText(b.imd, config.gate.imdDecimals)} IMD
          </span>
          <span
            title={`${balanceText(b.staked, config.gate.stakedDecimals)} staked IMD`}
          >
            {balanceText(b.staked, config.gate.stakedDecimals)} staked
          </span>
        </span>
      ) : (
        <span className="muted">balances…</span>
      )}
    </span>
  );
}
function Time({ time }: { time: number }) {
  const date = new Date(time * 1000);
  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString()}>
      {date.toLocaleDateString("en", { month: "short", day: "numeric" })}
    </time>
  );
}
function Meta({ item, mainnet = false }: { item: Comment; mainnet?: boolean }) {
  return (
    <div className="metadata">
      <Author address={item.author} />
      <span>
        <Time time={item.time} />
        {mainnet && <span className="storage-note"> · on mainnet</span>}
      </span>
    </div>
  );
}
function Subject({ refValue }: { refValue: string }) {
  return (
    <div className="subject-links">
      <a
        className="subject-chip"
        href={subjectUrl(refValue)}
        target="_blank"
        rel="noreferrer"
        title={refValue}
      >
        {subjectLabel(refValue, true)} ↗
      </a>
      <a
        className="muted subject-discussion"
        href={`#/s/${encodeURIComponent(refValue)}`}
      >
        related ideas →
      </a>
    </div>
  );
}
function Body({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = body.length > 650 || body.split("\n").length > 9;
  return (
    <div className="body">
      <p dir="auto" className={!expanded && long ? "collapsed" : ""}>
        {body}
      </p>
      {long && (
        <button
          className="text-button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "show less ↑" : "read full text ↓"}
        </button>
      )}
    </div>
  );
}
function Gate() {
  const { wallet, badges, config, retryBadges, openWallet } = useDocket();
  if (!wallet.address)
    return (
      <p className="gate">
        <button className="text-button" onClick={openWallet}>
          connect a wallet
        </button>{" "}
        to add an idea, comment, or upvote.
      </p>
    );
  const b = badges[wallet.address.toLowerCase()];
  if (!b)
    return (
      <p className="gate" role="status">
        Checking mainnet balances…
      </p>
    );
  if (b.error)
    return (
      <p className="gate">
        Balances unavailable; writing is paused.{" "}
        <button className="text-button" onClick={retryBadges}>
          retry balances
        </button>
      </p>
    );
  if (b.eligible) return null;
  return (
    <p className="gate">
      Writing needs {config.gate.minSeats}+ identitymd seat
      {config.gate.minSeats === "1" ? "" : "s"} or more than{" "}
      {config.gate.minTokensExclusive} IMD, including staked.{" "}
      <a href="https://imd.fun" target="_blank" rel="noreferrer">
        imd.fun ↗
      </a>
    </p>
  );
}
function useEligible() {
  const { wallet, badges } = useDocket();
  return !!(wallet.address && badges[wallet.address.toLowerCase()]?.eligible);
}
function NetworkNotice({
  target,
  creating = false,
}: {
  target?: number;
  creating?: boolean;
}) {
  const { wallet, config } = useDocket();
  if (!wallet.address) return null;
  const supported = config.chains.some((b) => b.chainId === wallet.chainId);
  if (!supported)
    return (
      <div className="notice cost">
        Choose the gas cost for your contribution.
        <div className="actions">
          <button onClick={() => void wallet.switchTo(8453)}>
            switch to Base
          </button>
          <button onClick={() => void wallet.switchTo(1)}>
            switch to mainnet
          </button>
        </div>
      </div>
    );
  if (target && wallet.chainId !== target)
    return (
      <div className="notice cost">
        {target === 1
          ? "This idea uses mainnet gas. Replying or upvoting costs real gas."
          : "Use Base’s lower gas cost to reply or upvote this idea."}
        <button onClick={() => void wallet.switchTo(target)}>
          switch to {target === 1 ? "mainnet" : "Base"}
        </button>
      </div>
    );
  if (wallet.chainId === 1)
    return (
      <div className="notice cost">
        {creating
          ? "Posting costs real gas on mainnet. Base usually costs a fraction of a cent; fees vary."
          : "Comments and upvotes on this idea cost real gas on mainnet."}
        {creating && (
          <button onClick={() => void wallet.switchTo(8453)}>
            switch to Base
          </button>
        )}
      </div>
    );
  return null;
}
function TxStatus({
  message,
  hash,
  chainId,
}: {
  message: string;
  hash?: Hex;
  chainId?: number;
}) {
  return (
    <div className="tx-status" role="status">
      {message}
      {hash &&
        (chainId === 1 || chainId === 8453 ? (
          <a
            href={`https://${chainId === 8453 ? "basescan.org" : "etherscan.io"}/tx/${hash}`}
            target="_blank"
            rel="noreferrer"
          >
            transaction {shortAddress(hash)} ↗
          </a>
        ) : (
          <span className="break-word">transaction {hash}</span>
        ))}
    </div>
  );
}
function Vote({
  idea,
  target,
  placement,
}: {
  idea: Idea;
  target: Comment;
  placement: string;
}) {
  const { wallet, badges, config, refresh, states } = useDocket();
  const eligible = useEligible();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [localVoter, setLocalVoter] = useState("");
  const [needsSwitch, setNeedsSwitch] = useState(false);
  const voted =
    !!wallet.address &&
    (target.voters.some(
      (a) => a.toLowerCase() === wallet.address!.toLowerCase(),
    ) ||
      localVoter === wallet.address.toLowerCase());
  const commentId = target === idea ? "0" : target.id;
  const kind = commentId === "0" ? "idea" : "comment";
  const count = target.voters.filter(
    (v) => badges[v.toLowerCase()]?.eligible,
  ).length;
  const missing = target.voters.some(
    (v) => !badges[v.toLowerCase()] || badges[v.toLowerCase()]?.error,
  );
  const unavailable =
    states.find((s) => s.chainId === idea.chainId)?.status === "error";
  async function vote() {
    if (!eligible || voted || pending || unavailable) return;
    if (wallet.chainId !== idea.chainId) {
      setNeedsSwitch(true);
      return;
    }
    setPending(true);
    setMessage("Confirm the upvote in your wallet.");
    try {
      const b = config.chains.find((b) => b.chainId === idea.chainId)!;
      const w = await wallet.client(idea.chainId);
      const p = clientFor(b);
      if (
        await p.readContract({
          address: b.address as Address,
          abi,
          functionName: "hasUpvoted",
          args: [BigInt(idea.id), BigInt(commentId), wallet.address!],
        })
      ) {
        setLocalVoter(wallet.address!.toLowerCase());
        setMessage("This wallet already upvoted.");
        return;
      }
      const hash = await w.writeContract({
        chain: w.chain,
        address: b.address as Address,
        abi,
        functionName: "upvote",
        args: [BigInt(idea.id), BigInt(commentId)],
      });
      setMessage("Upvote pending…");
      const receipt = await p.waitForTransactionReceipt({
        hash,
        timeout: 180000,
      });
      if (receipt.status !== "success")
        throw new Error("Transaction reverted.");
      setLocalVoter(wallet.address!.toLowerCase());
      setMessage("Upvote confirmed.");
      await refresh(idea.chainId);
      await refresh(idea.chainId);
    } catch (e) {
      setMessage(readableError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="vote-wrap">
      <div className="vote-row">
        <button
          className={"vote" + (voted ? " voted" : "")}
          disabled={!eligible || voted || pending || unavailable}
          aria-label={`${voted ? "upvoted" : "upvote"} ${kind} ${placement}`}
          title={
            voted
              ? "This wallet has already upvoted"
              : !eligible
                ? "Connect an eligible wallet to upvote"
                : "Upvote once with this wallet"
          }
          onClick={() => void vote()}
        >
          <span aria-hidden="true">{voted ? "✓" : "↑"}</span>{" "}
          {target.voters.length}
          <span className="sr-only"> all upvotes</span>
        </button>
        <span
          className="holder-count"
          title="Upvotes from wallets meeting the configured mainnet holding threshold, using this session’s balances"
        >
          {count}
          {missing ? "+" : ""} holder{count === 1 ? "" : "s"}
          {missing && <span className="sr-only">; balances incomplete</span>}
        </span>
      </div>
      {needsSwitch && wallet.chainId !== idea.chainId && (
        <NetworkNotice target={idea.chainId} />
      )}
      <span className="vote-message" role="status">
        {message}
      </span>
    </div>
  );
}
function Composer({
  idea,
  initialSubject,
}: {
  idea?: Idea;
  initialSubject?: string;
}) {
  const { wallet, config, refresh, states } = useDocket();
  const eligible = useEligible();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState(initialSubject?.split(":")[0] || "free");
  const [ref, setRef] = useState(
    initialSubject?.split(":").slice(1).join(":") || "",
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [hash, setHash] = useState<Hex>();
  const titleEl = useRef<HTMLInputElement>(null);
  const bodyEl = useRef<HTMLTextAreaElement>(null);
  const subjectEl = useRef<HTMLInputElement>(null);
  const rawSubject =
    kind === "free" ? "" : ref.includes(":") ? ref : `${kind}:${ref}`;
  const subject = normalizeSubject(rawSubject);
  const encoded =
    !idea && rawSubject ? `subject: ${subject || rawSubject}\n${body}` : body;
  const limit = idea ? 2000 : 4000;
  const target = idea?.chainId ?? wallet.chainId;
  const board = config.chains.find((c) => c.chainId === target);
  const ready =
    !!board?.address &&
    (!idea ||
      states.find((s) => s.chainId === idea.chainId)?.status !== "error");
  const supported = !!board;
  const disabled = !eligible || !ready || wallet.chainId !== target || pending;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    const e: Record<string, string> = {};
    if (!idea && (bytes(title) < 1 || bytes(title) > 120))
      e.title = "Use 1–120 bytes for the title.";
    if (bytes(encoded) < 1 || bytes(encoded) > limit)
      e.body = `Use 1–${limit} bytes, including the subject line.`;
    if (!idea && rawSubject && !subject)
      e.subject =
        "Use a UUID for a job or oracle, or a numeric launch or agent ID.";
    setErrors(e);
    if (Object.keys(e).length) {
      (e.title ? titleEl : e.subject ? subjectEl : bodyEl).current?.focus();
      return;
    }
    setPending(true);
    setHash(undefined);
    setMessage("Confirm in your wallet.");
    try {
      const w = await wallet.client(target);
      const h = idea
        ? await w.writeContract({
            chain: w.chain,
            address: board!.address as Address,
            abi,
            functionName: "comment",
            args: [BigInt(idea.id), body],
          })
        : await w.writeContract({
            chain: w.chain,
            address: board!.address as Address,
            abi,
            functionName: "createIdea",
            args: [title, encoded],
          });
      setHash(h);
      setMessage("Transaction pending… your text is kept until confirmation.");
      const receipt = await clientFor(board!).waitForTransactionReceipt({
        hash: h,
        timeout: 180000,
      });
      if (receipt.status !== "success")
        throw new Error("Transaction reverted.");
      setMessage(idea ? "Comment confirmed." : "Idea confirmed.");
      setBody("");
      setTitle("");
      await refresh(target);
      await refresh(target);
      if (!idea) {
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== board!.address.toLowerCase())
            continue;
          try {
            const event = decodeEventLog({
              abi,
              data: log.data,
              topics: log.topics,
            });
            if (event.eventName === "IdeaCreated") {
              go(`/i/${target}/${event.args.ideaId}`);
              break;
            }
          } catch {
            /* Other receipt logs. */
          }
        }
      }
    } catch (err) {
      setMessage(readableError(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      className={"composer" + (idea ? " comment-composer" : "")}
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <div className="section-heading">
        {idea ? (
          <h3>add a comment</h3>
        ) : (
          <h2 id="view-heading" tabIndex={-1}>
            new idea
          </h2>
        )}
        {!idea && (
          <a className="text-button" href="#/">
            cancel
          </a>
        )}
      </div>
      {!idea && (
        <p className="muted">
          What should the swarm build next? Start with a clear outcome.
        </p>
      )}
      <Gate />
      <NetworkNotice target={idea?.chainId} creating={!idea} />
      {wallet.address && supported && !board?.address && (
        <p className="notice">
          This board is unconfigured. <a href="#/deploy">deploy a board →</a>
        </p>
      )}
      {idea && !ready && (
        <p className="notice">
          This idea is unavailable. Retry its connection before replying.
        </p>
      )}
      <fieldset disabled={!eligible || pending}>
        {!idea && (
          <>
            <label htmlFor="idea-title">
              title{" "}
              <span
                className={bytes(title) > 120 ? "invalid counter" : "counter"}
              >
                {bytes(title)} / 120 bytes
              </span>
            </label>
            <input
              ref={titleEl}
              id="idea-title"
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="A useful, specific job idea"
              aria-invalid={!!errors.title || bytes(title) > 120}
              aria-describedby="title-error"
            />
            <p id="title-error" className="field-error">
              {errors.title ||
                (bytes(title) > 120 ? "Title exceeds 120 bytes." : "")}
            </p>
            <div className="subject-picker">
              <label htmlFor="subject-kind">
                subject <span className="muted">optional</span>
              </label>
              <div className="subject-fields">
                <select
                  id="subject-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  <option value="free">free idea</option>
                  <option value="job">on a job</option>
                  <option value="launch">on a launch</option>
                  <option value="agent">on an agent</option>
                  <option value="oracle">on an oracle</option>
                </select>
                {kind !== "free" && (
                  <div className="subject-input">
                    <label className="sr-only" htmlFor="subject-ref">
                      subject reference
                    </label>
                    <input
                      ref={subjectEl}
                      id="subject-ref"
                      value={ref}
                      onChange={(e) => setRef(e.target.value)}
                      placeholder={
                        kind === "job" || kind === "oracle"
                          ? "UUID or full reference"
                          : "ID or full reference"
                      }
                      aria-invalid={!!errors.subject}
                      aria-describedby="subject-error"
                    />
                  </div>
                )}
              </div>
              <p id="subject-error" className="field-error">
                {errors.subject}
              </p>
            </div>
          </>
        )}
        <label htmlFor={idea ? "comment-body" : "idea-body"}>
          {idea ? "comment" : "body"}
          <span
            className={bytes(encoded) > limit ? "invalid counter" : "counter"}
          >
            {bytes(encoded)} / {limit} bytes
          </span>
        </label>
        <textarea
          ref={bodyEl}
          id={idea ? "comment-body" : "idea-body"}
          rows={idea ? 4 : 8}
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            idea
              ? "Add context, a question, or a better approach."
              : "Describe the outcome and why it would be useful."
          }
          aria-invalid={!!errors.body || bytes(encoded) > limit}
          aria-describedby="body-error"
        />
        <p id="body-error" className="field-error">
          {errors.body ||
            (bytes(encoded) > limit ? `Body exceeds ${limit} bytes.` : "")}
        </p>
      </fieldset>
      <div className="compose-bottom">
        <span className="muted">plain text · permanent onchain</span>
        <button
          className={idea ? "" : "primary"}
          type="submit"
          disabled={disabled}
        >
          {pending ? "confirming…" : idea ? "add comment →" : "publish idea →"}
        </button>
      </div>
      <TxStatus message={message} hash={hash} chainId={target} />
    </form>
  );
}
function SubjectCard({ subject }: { subject: string }) {
  const [data, setData] = useState<Record<string, unknown>>();
  useEffect(() => {
    setData(undefined);
    const [kind, id] = subject.split(":");
    const url =
      kind === "job"
        ? `https://api.imd.fun/jobs/${id}`
        : kind === "agent"
          ? `https://explorer.imd.fun/api/agents/${id}`
          : undefined;
    if (!url) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    void fetch(url, { signal: controller.signal, credentials: "omit" })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d) => {
        const v = d.job || d.agent || d;
        setData({ ...v, repo: v.repo || v.delivery?.repoUrl });
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [subject]);
  const text = (v: unknown) =>
    typeof v === "string"
      ? v
      : typeof v === "number" || typeof v === "boolean"
        ? String(v)
        : "";
  return (
    <div className="subject-card">
      <SmallLabel>ideas about the swarm’s work</SmallLabel>
      <h2 id="subject-heading" tabIndex={-1}>
        {subjectLabel(subject, true)}
      </h2>
      <a href={subjectUrl(subject)} target="_blank" rel="noreferrer">
        {subjectUrl(subject).replace("https://", "")} ↗
      </a>
      {data && (
        <div className="live-subject">
          <SmallLabel>live from explorer</SmallLabel>
          <div className="subject-facts">
            {["state", "template", "online", "accepted", "attempts"]
              .filter((k) => data[k] !== undefined)
              .map((k) => (
                <span key={k}>
                  {k}: {text(data[k])}
                </span>
              ))}
          </div>
          {data.objective !== undefined && (
            <p>{text(data.objective).slice(0, 300)}</p>
          )}
          {data.repo !== undefined && <p>repo: {text(data.repo)}</p>}
        </div>
      )}
    </div>
  );
}
function Detail({ idea }: { idea: Idea }) {
  const { badges, states } = useDocket();
  const [sort, setSort] = useState("chronological");
  const comments = [...idea.comments].sort((a, b) =>
    sort === "holders"
      ? b.voters.filter((v) => badges[v.toLowerCase()]?.eligible).length -
          a.voters.filter((v) => badges[v.toLowerCase()]?.eligible).length ||
        a.time - b.time
      : a.time - b.time || (BigInt(a.id) < BigInt(b.id) ? -1 : 1),
  );
  return (
    <article className="detail">
      <a className="back" href="#/">
        ← job ideas
      </a>
      <div className="detail-topline">
        <SmallLabel>idea / {idea.id.padStart(3, "0")}</SmallLabel>
        <span className="muted">{commentCount(idea.comments.length)}</span>
      </div>
      {states.find((s) => s.chainId === idea.chainId)?.status === "error" && (
        <p className="notice">
          Unavailable · showing cached text. Retry the connection to continue.
        </p>
      )}
      {idea.subject && <Subject refValue={idea.subject} />}
      <h2 id="view-heading" tabIndex={-1}>
        {idea.title}
      </h2>
      <Meta item={idea} mainnet={idea.chainId === 1} />
      <Body body={idea.body} />
      <Vote idea={idea} target={idea} placement="header" />
      <div className="comments-heading">
        <h3>
          the discussion <span className="muted">/ {idea.comments.length}</span>
        </h3>
        <label className="sort">
          sort comments
          <select
            aria-label="sort comments"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="chronological">chronological</option>
            <option value="holders">holder upvotes</option>
          </select>
        </label>
      </div>
      {comments.length === 0 && (
        <p className="empty-comments muted">
          No comments yet. Help give this idea a clearer shape.
        </p>
      )}
      <ol className="comments">
        {comments.map((c) => (
          <li key={c.id}>
            <Meta item={c} />
            <Body body={c.body} />
            <Vote idea={idea} target={c} placement={c.id} />
          </li>
        ))}
      </ol>
      <Composer key={keyOf(idea)} idea={idea} />
    </article>
  );
}
function Deployment() {
  const { wallet, config } = useDocket();
  const [deploymentChain, setDeploymentChain] = useState<number>();
  const [message, setMessage] = useState("");
  const [hash, setHash] = useState<Hex>();
  const [result, setResult] = useState<{
    address: Address;
    block: string;
    chain: number;
  }>();
  const [pending, setPending] = useState(false);
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState(false);
  async function compiler() {
    try {
      const r = await fetch("./compiler-input.json");
      if (!r.ok) throw new Error();
      setInput(JSON.stringify(await r.json(), null, 2));
      setInputError(false);
    } catch {
      setInputError(true);
    }
  }
  useEffect(() => {
    void compiler();
  }, []);
  async function deploy() {
    if (!wallet.address || !wallet.chainId || pending) return;
    setPending(true);
    setResult(undefined);
    setHash(undefined);
    setMessage("Confirm deployment in your wallet.");
    const id = wallet.chainId;
    setDeploymentChain(id);
    try {
      const w = await wallet.client(id);
      const tx = await w.deployContract({
        abi: [],
        bytecode: artifact.bytecode as Hex,
        chain: w.chain,
        account: wallet.address,
      });
      setHash(tx);
      setMessage("Deployment pending… keep this page open.");
      const board = config.chains.find((b) => b.chainId === id);
      const receipt = board
        ? await clientFor(board).waitForTransactionReceipt({
            hash: tx,
            timeout: 180000,
          })
        : await wallet.deployReceipt(tx, id);
      if (receipt.status !== "success" || !receipt.contractAddress)
        throw new Error("Deployment reverted.");
      setResult({
        address: receipt.contractAddress,
        block: receipt.blockNumber.toString(),
        chain: id,
      });
      setMessage("Deployment confirmed.");
    } catch (e) {
      setMessage(readableError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="deploy-page">
      <a href="#/" className="back always">
        ← job ideas
      </a>
      <SmallLabel>board setup / docket v0.1</SmallLabel>
      <h2 id="view-heading" tabIndex={-1}>
        deploy a board
      </h2>
      <p>
        Deploy an unmodified Docket with your wallet. This board is ignored
        until <code>config.json</code> points at its address and deployment
        block.
      </p>
      <div className="notice">
        <p>
          {wallet.address
            ? `Your wallet will deploy on ${chainName(wallet.chainId || 0)}. Deployment costs gas.`
            : "Connect a wallet to choose the network and pay deployment gas."}
        </p>
        <p>No constructor arguments. No owner or admin.</p>
      </div>
      <button
        className="primary"
        disabled={!wallet.address || pending}
        onClick={() => void deploy()}
      >
        {pending ? "deploying…" : "deploy Docket →"}
      </button>
      <TxStatus message={message} hash={hash} chainId={deploymentChain} />
      {result && (
        <dl className="deploy-result">
          <dt>transaction</dt>
          <dd>{hash}</dd>
          <dt>contract address</dt>
          <dd data-testid="deployed-address">{result.address}</dd>
          <dt>deployment block</dt>
          <dd data-testid="deployed-block">{result.block}</dd>
          <dt>chain ID</dt>
          <dd>{result.chain}</dd>
        </dl>
      )}
      <h3>verify the contract</h3>
      <p>Use Solidity standard-JSON input with these exact settings.</p>
      <dl className="settings">
        <dt>compiler</dt>
        <dd>v0.8.26+commit.8a97fa7a</dd>
        <dt>contract</dt>
        <dd>src/Docket.sol:Docket</dd>
        <dt>optimizer</dt>
        <dd>enabled · 200 runs</dd>
        <dt>EVM</dt>
        <dd>cancun</dd>
        <dt>metadata bytecode hash</dt>
        <dd>none</dd>
        <dt>constructor arguments</dt>
        <dd>none</dd>
      </dl>
      <a href="./compiler-input.json" download="docket-compiler-input.json">
        download standard-JSON input ↓
      </a>
      <details>
        <summary>view standard-JSON input</summary>
        {inputError ? (
          <p>
            Compiler input could not be read.{" "}
            <button onClick={() => void compiler()}>
              retry compiler input
            </button>
          </p>
        ) : (
          <pre>{input || "Loading compiler input…"}</pre>
        )}
      </details>
      <h3>point the site at your board</h3>
      <p>
        Copy the address and deployment block into the matching chain entry in{" "}
        <code>config.json</code>, next to <code>index.html</code>. Set a public
        RPC URL, then re-publish the same static files. No rebuild is needed.
      </p>
      <a
        href="https://github.com/identity-md-launches/launch-197-build-docket-v0-1-smallest/tree/fce1f50b47ba5ee04d60ed5fb69cfea0a88060b4"
        target="_blank"
        rel="noreferrer"
      >
        Docket v0.1 contract source ↗
      </a>
    </section>
  );
}
export default function App({ config }: { config: Config }) {
  const wallet = useWallet(config);
  const board = useBoards(config);
  const route = useRoute();
  const addresses = board.ideas.flatMap((i) => [
    i.author,
    ...i.voters,
    ...i.comments.flatMap((c) => [c.author, ...c.voters]),
  ]);
  if (wallet.address) addresses.push(wallet.address);
  const { badges, retry } = useBadges(config, addresses);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("holders");
  const [theme, setTheme] = useState(
    document.documentElement.dataset.theme || "light",
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  let subject: string | undefined;
  try {
    if (route.startsWith("/s/"))
      subject = normalizeSubject(decodeURIComponent(route.slice(3)));
  } catch {
    /* Invalid hash. */
  }
  const filtered = board.ideas
    .filter((i) =>
      subject
        ? i.subject === subject
        : filter === "all"
          ? true
          : filter === "free"
            ? !i.subject
            : i.subject?.startsWith(filter + ":"),
    )
    .sort((a, b) => {
      const time =
        b.time - a.time ||
        a.chainId - b.chainId ||
        (BigInt(a.id) > BigInt(b.id) ? -1 : 1);
      return sort === "newest"
        ? time
        : b.voters.filter((v) => badges[v.toLowerCase()]?.eligible).length -
            a.voters.filter((v) => badges[v.toLowerCase()]?.eligible).length ||
            time;
    });
  const explicit = route.startsWith("/i/");
  const selected = explicit
    ? board.ideas.find((i) => `/i/${keyOf(i)}` === route)
    : filtered[0];
  const isNew = route === "/new";
  const isDeploy = route === "/deploy";
  const allUnconfigured = board.states.every(
    (s) => s.status === "unconfigured",
  );
  const context: Context = {
    config,
    wallet,
    badges,
    retryBadges: retry,
    states: board.states,
    refresh: board.refresh,
    openWallet: () => dialog.current?.showModal(),
  };
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem("docket-theme", next);
    } catch {
      /* Theme remains set in this tab. */
    }
  }
  return (
    <Context.Provider value={context}>
      <a className="skip" href="#main">
        skip to content
      </a>
      <div className="site-shell">
        <header className="site-header">
          <a className="wordmark" href="#/" aria-label="THE DOCKET home">
            <span className="mark" aria-hidden="true">
              D
            </span>
            <span>THE DOCKET</span>
          </a>
          <nav aria-label="site">
            <a
              href="https://explorer.imd.fun"
              target="_blank"
              rel="noreferrer"
              className="explorer-link"
            >
              explorer ↗
            </a>
            <a href="#/deploy">deploy</a>
            <button
              className="theme-toggle"
              aria-label={`use ${theme === "light" ? "dark" : "light"} theme`}
              onClick={toggleTheme}
            >
              <span aria-hidden="true">{theme === "light" ? "◐" : "◑"}</span>
              <span>{theme === "light" ? "dark" : "light"}</span>
            </button>
            <button
              ref={trigger}
              className="connect"
              onClick={() => dialog.current?.showModal()}
            >
              {wallet.address ? shortAddress(wallet.address) : "connect wallet"}
              <span aria-hidden="true"> ↗</span>
            </button>
          </nav>
        </header>
        <main id="main" tabIndex={-1}>
          <div className="masthead">
            <div>
              <SmallLabel>an open notebook for the IMD swarm</SmallLabel>
              <h1>
                Good work starts
                <br className="mobile-break" /> with an idea.
              </h1>
              <p>Shape what comes next. Discuss what’s been built.</p>
            </div>
            <span className="edition">
              THE DOCKET
              <br />
              community edition / 01
            </span>
          </div>
          {wallet.error && (
            <p className="notice" role="alert">
              {wallet.error}
            </p>
          )}
          {wallet.address &&
            !config.chains.some((c) => c.chainId === wallet.chainId) &&
            !isDeploy && <NetworkNotice />}
          {isDeploy ? (
            <Deployment />
          ) : (
            <>
              <div className="board-toolbar">
                <div className="section-heading">
                  <h2 id="ideas-heading" tabIndex={-1}>
                    job ideas{" "}
                    <span className="muted">
                      / {String(board.ideas.length).padStart(2, "0")}
                    </span>
                  </h2>
                  <span className="read-note">
                    open to read, onchain to contribute
                  </span>
                </div>
                <a className={isNew ? "button" : "button primary"} href="#/new">
                  + new idea
                </a>
              </div>
              <div className="connection-states" aria-live="polite">
                {board.states
                  .filter((s) => s.status !== "ready")
                  .map((s) => (
                    <div key={s.chainId} className={`connection ${s.status}`}>
                      <span className="status-dot" aria-hidden="true" />
                      <span>
                        {chainName(s.chainId)} ·{" "}
                        {s.status === "unconfigured"
                          ? "unconfigured"
                          : s.status === "loading"
                            ? "reading messages…"
                            : "unavailable"}
                        {s.status === "error" && (
                          <span className="connection-detail">
                            {" "}
                            — {s.message}
                          </span>
                        )}
                      </span>
                      {s.status === "unconfigured" ? (
                        <a href="#/deploy">set up →</a>
                      ) : s.status === "error" ? (
                        <button onClick={() => void board.refresh(s.chainId)}>
                          retry connection
                        </button>
                      ) : null}
                    </div>
                  ))}
              </div>
              {subject && <SubjectCard subject={subject} />}
              <div
                className={`board-grid ${explicit || isNew ? "mobile-open" : ""}`}
              >
                <aside className="idea-list" aria-label="job ideas">
                  <div className="list-controls">
                    <nav className="filters" aria-label="filter job ideas">
                      {(["all", "free", "job", "launch", "agent"] as const).map(
                        (f) => (
                          <button
                            key={f}
                            aria-pressed={!subject && filter === f}
                            onClick={() => {
                              setFilter(f);
                              if (route !== "/") go("/");
                            }}
                          >
                            {f === "all" || f === "free" ? f : `on ${f}s`}
                          </button>
                        ),
                      )}
                    </nav>
                    <div className="list-caption">
                      <span>
                        {subject
                          ? "on this subject"
                          : `${filtered.length} ${filtered.length === 1 ? "idea" : "ideas"}`}
                      </span>
                      <label className="sort">
                        <span className="sr-only">sort ideas</span>
                        <select
                          aria-label="sort ideas"
                          value={sort}
                          onChange={(e) => setSort(e.target.value)}
                        >
                          <option value="holders">holder upvotes ↓</option>
                          <option value="newest">newest ↓</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  <Gate />
                  {filtered.length === 0 ? (
                    <div className="list-empty">
                      <span className="empty-symbol" aria-hidden="true">
                        [ — ]
                      </span>
                      <h3>
                        {allUnconfigured
                          ? "A place for the next idea."
                          : board.states.some((s) => s.status === "loading")
                            ? "Reading the docket…"
                            : "No ideas here yet."}
                      </h3>
                      <p>
                        {allUnconfigured
                          ? "Connect a board to start reading and contributing."
                          : board.states.some((s) => s.status === "error")
                            ? "Some ideas are unavailable. Retry the connection above."
                            : "Start a new idea or choose another filter."}
                      </p>
                      {subject && <a href="#/new">+ new idea</a>}
                    </div>
                  ) : (
                    <ol className="ideas">
                      {filtered.map((idea, index) => (
                        <li
                          className={
                            selected && keyOf(selected) === keyOf(idea)
                              ? "selected"
                              : ""
                          }
                          key={keyOf(idea)}
                        >
                          <div className="idea-row-head">
                            <span className="index">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <a
                              className="idea-title"
                              href={`#/i/${keyOf(idea)}`}
                            >
                              {idea.title}
                            </a>
                          </div>
                          {idea.subject && <Subject refValue={idea.subject} />}
                          <p className="excerpt">{idea.body}</p>
                          <Meta item={idea} mainnet={idea.chainId === 1} />
                          <div className="idea-row-bottom">
                            <Vote
                              idea={idea}
                              target={idea}
                              placement={`list ${idea.id}`}
                            />
                            <a
                              className="comment-count"
                              href={`#/i/${keyOf(idea)}`}
                            >
                              {commentCount(idea.comments.length)} ↗
                            </a>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </aside>
                <div className="reading-pane">
                  {isNew ? (
                    <>
                      <a className="back" href="#/">
                        ← job ideas
                      </a>
                      <Composer initialSubject={subject} />
                    </>
                  ) : selected ? (
                    <Detail key={keyOf(selected)} idea={selected} />
                  ) : (
                    <div className="setup-empty">
                      <SmallLabel>
                        {allUnconfigured
                          ? "before the first idea"
                          : "the open notebook"}
                      </SmallLabel>
                      <h2 id="view-heading" tabIndex={-1}>
                        {allUnconfigured
                          ? "An open board.\nReady when you are."
                          : explicit
                            ? "This idea is unavailable."
                            : "Make room for an idea."}
                      </h2>
                      <p>
                        {allUnconfigured
                          ? "The Docket is a shared place to shape useful work for the swarm. Its messages live onchain, and anyone can read them."
                          : explicit
                            ? "Check its address in the URL or retry the connection."
                            : "A question, a useful tool, a better way to do something. It starts here."}
                      </p>
                      {allUnconfigured ? (
                        <>
                          <ol className="setup-steps">
                            <li>
                              <span>01</span>
                              <div>
                                deploy a Docket
                                <p>Use your wallet to create the board.</p>
                              </div>
                            </li>
                            <li>
                              <span>02</span>
                              <div>
                                point the site at it
                                <p>
                                  Add the address to config.json and re-publish.
                                </p>
                              </div>
                            </li>
                            <li>
                              <span>03</span>
                              <div>
                                let the ideas take shape
                                <p>
                                  Read freely. Contribute with your IMD
                                  holdings.
                                </p>
                              </div>
                            </li>
                          </ol>
                          <a className="button" href="#/deploy">
                            set up a board →
                          </a>
                        </>
                      ) : (
                        <a className="button" href={explicit ? "#/" : "#/new"}>
                          {explicit
                            ? "back to job ideas"
                            : "start a new idea →"}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
        <footer>
          <p>
            this site only reads messages posted onchain by their authors.
            community built, not an official imd site.
          </p>
          <a href="https://imd.fun" target="_blank" rel="noreferrer">
            imd.fun ↗
          </a>
        </footer>
      </div>
      <dialog
        ref={dialog}
        onClose={() => {
          wallet.cancelConnect();
          trigger.current?.focus();
        }}
      >
        <div className="section-heading">
          <h2>your wallet</h2>
          <button
            aria-label="close wallet dialog"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </div>
        {wallet.address ? (
          <>
            <p className="break-word">{wallet.address}</p>
            <button
              onClick={() =>
                void wallet.disconnect().then(() => dialog.current?.close())
              }
            >
              disconnect wallet
            </button>
          </>
        ) : (
          <>
            <p>Connect to contribute. Reading is always open.</p>
            {wallet.qr && (
              <div className="wallet-qr">
                <img
                  src={wallet.qr}
                  width={280}
                  height={280}
                  alt="WalletConnect pairing QR code"
                />
                <p>Scan with your wallet to connect.</p>
              </div>
            )}
            <div className="wallet-options">
              {wallet.choices.map((c) => (
                <button
                  key={c.id}
                  disabled={wallet.busy}
                  onClick={() =>
                    void wallet.connect(c).then((ok) => {
                      if (ok) dialog.current?.close();
                    })
                  }
                >
                  {wallet.busy ? "connecting…" : c.name} ↗
                </button>
              ))}
              {wallet.choices.length === 0 && (
                <p className="muted">
                  No browser wallet found. Open this site in your wallet’s
                  browser, or use WalletConnect.
                </p>
              )}
              <button
                disabled={!config.walletConnectProjectId || wallet.busy}
                onClick={() =>
                  void wallet.connect().then((ok) => {
                    if (ok) dialog.current?.close();
                  })
                }
              >
                WalletConnect ↗
              </button>
              {!config.walletConnectProjectId && (
                <p className="muted">
                  WalletConnect is unconfigured. The site operator can add its
                  public project ID in config.json.
                </p>
              )}
            </div>
          </>
        )}
        {wallet.error && <p role="alert">{wallet.error}</p>}
        <p className="muted small">
          Connecting does not send a transaction or switch your network.
        </p>
      </dialog>
    </Context.Provider>
  );
}
