/** The part of a commit the graph needs; commits come newest first, parents after their children. */
export interface CommitSummary {
  hash: string;
  parents: string[];
}

export interface GraphRow {
  lane: number;
  color: number;
}

export interface GraphPoint {
  row: number;
  lane: number;
}

/** One coloured polyline for SVG: first point is where it starts, last where it ends; a lane change happens at a point. */
export interface BranchSegment {
  color: number;
  points: GraphPoint[];
  /** The line runs on past the last row (parent not loaded). */
  truncated?: boolean;
}

export interface CommitGraph {
  rows: GraphRow[];
  segments: BranchSegment[];
  laneCount: number;
}

export interface GraphOptions {
  /** Number of colours in the palette; colours are indices modulo this. */
  colors?: number;
  /** Skip merge (non-first-parent) edges: cheaper for huge histories. */
  lean?: boolean;
}

/** O(N) colouring: a commit without a colour starts a new one, its first parent inherits it. */
export function colorRows(commits: CommitSummary[], rowOf: Map<string, number>, colors = 8): number[] {
  const color = new Array<number>(commits.length).fill(-1);
  let next = 0;
  for (let r = 0; r < commits.length; r++) {
    if (color[r] < 0) color[r] = next++ % colors;
    const first = commits[r]!.parents[0];
    const p = first === undefined ? undefined : rowOf.get(first);
    if (p !== undefined && p > r && color[p]! < 0) color[p] = color[r]!;
  }
  return color;
}

/** Lane assignment and branch segments for a page of commits. */
export function buildGraph(commits: CommitSummary[], options: GraphOptions = {}): CommitGraph {
  const n = commits.length;
  const rowOf = new Map<string, number>();
  commits.forEach((c, i) => rowOf.set(c.hash, i));
  const color = colorRows(commits, rowOf, options.colors ?? 8);
  const rows: GraphRow[] = new Array(n);
  const segments: BranchSegment[] = [];
  const laneTarget: number[] = [];
  const laneSeg: number[] = [];
  let laneCount = 0;

  const freeLane = () => {
    let i = laneTarget.indexOf(-1);
    if (i < 0) {
      i = laneTarget.length;
      laneTarget.push(-1);
      laneSeg.push(-1);
    }
    return i;
  };
  const open = (lane: number, row: number, target: number, colorIdx: number) => {
    laneTarget[lane] = target;
    laneSeg[lane] = segments.length;
    segments.push({ color: colorIdx, points: [{ row, lane }] });
  };
  const close = (lane: number, at: GraphPoint) => {
    segments[laneSeg[lane]!]!.points.push(at);
    laneTarget[lane] = -1;
    laneSeg[lane] = -1;
  };

  for (let r = 0; r < n; r++) {
    let lane = laneTarget.indexOf(r);
    if (lane < 0) lane = freeLane();
    rows[r] = { lane, color: color[r]! };
    laneCount = Math.max(laneCount, lane + 1);
    const here = { row: r, lane };

    const parents = commits[r]!.parents;
    const firstRow = parents.length ? rowOf.get(parents[0]!) : undefined;
    const firstOk = firstRow !== undefined && firstRow > r;

    for (let l = 0; l < laneTarget.length; l++) {
      if (laneTarget[l] !== r) continue;
      if (l === lane && firstOk) continue;
      close(l, here);
    }

    if (firstOk) {
      if (laneTarget[lane] === r) laneTarget[lane] = firstRow;
      else open(lane, r, firstRow, color[r]!);
    } else if (parents.length) {
      open(lane, r, -2, color[r]!);
      segments[laneSeg[lane]!]!.truncated = true;
      segments[laneSeg[lane]!]!.points.push({ row: n, lane });
      laneTarget[lane] = -1;
      laneSeg[lane] = -1;
    }

    if (options.lean) continue;
    for (let k = 1; k < parents.length; k++) {
      const p = rowOf.get(parents[k]!);
      if (p === undefined || p <= r) continue;
      const existing = laneTarget.indexOf(p);
      if (existing >= 0) {
        segments.push({ color: color[p]!, points: [here, { row: Math.min(r + 1, p), lane: existing }] });
        continue;
      }
      const l = freeLane();
      laneCount = Math.max(laneCount, l + 1);
      open(l, r, p, color[p]!);
    }
  }
  return { rows, segments, laneCount };
}
