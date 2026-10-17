// Editing YAML files as Documents, so a write changes only what it must: comments, key order, quoting and unknown keys
// all survive (docs/02-architecture.md, "The write path"). Plus pinning problems to a line and column.
import YAML, { isMap, isScalar, isSeq, LineCounter, Pair, Scalar, type Document, type Node, YAMLMap, YAMLSeq } from 'yaml';
import type { Field, KeyPath } from './schema.js';

export interface Parsed {
  doc: Document.Parsed;
  lc: LineCounter;
  /** The first syntax error, if any, with its position. */
  error: { message: string; line?: number; col?: number } | null;
}

export function parse(raw: string): Parsed {
  const lc = new LineCounter();
  const doc = YAML.parseDocument(raw, { lineCounter: lc, prettyErrors: true });
  const e = doc.errors[0];
  return {
    doc,
    lc,
    error: e ? { message: e.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, ''), line: e.linePos?.[0].line, col: e.linePos?.[0].col } : null,
  };
}

/** Where `key` is in the file: the value's node (or, with `atKey`, the key's), else the nearest ancestor that exists. */
export function locate(p: Parsed, key: KeyPath, atKey = false): { line: number; col: number } | undefined {
  for (let n = key.length; n >= 0; n--) {
    const k = key.slice(0, n);
    let node: unknown;
    if (atKey && n === key.length && n > 0) {
      const parent = p.doc.getIn(k.slice(0, -1), true);
      node = isMap(parent) ? parent.items.find((it) => (isScalar(it.key) ? it.key.value : it.key) === k[k.length - 1])?.key : undefined;
    } else node = n === 0 ? p.doc.contents : p.doc.getIn(k, true);
    const range = (node as Node | undefined)?.range;
    if (range) return p.lc.linePos(range[0]);
  }
  return undefined;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A new node for `value`. Short lists of scalars are written inline (`tags: [a, b]`), as people write them. */
function createNode(doc: Document, value: unknown): Node {
  const node = doc.createNode(value) as Node;
  if (isSeq(node) && (value as unknown[]).every((v) => !isPlainObject(v) && !Array.isArray(v))) node.flow = true;
  return node;
}

/**
 * Make `node` hold `value`, changing as little as possible: a scalar keeps its comments; a mapping keeps its other
 * keys (unless `prune` says to drop them); a list keeps its style. Returns the node to put in place (maybe new).
 */
/** A merge-patch's object with its null (deleting) members dropped, at every depth. */
function withoutNulls(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, isPlainObject(v) ? withoutNulls(v as Record<string, unknown>) : v]));
}

function setNode(doc: Document, node: unknown, value: unknown, prune: (key: string) => boolean, schema: Field | undefined): Node {
  if (isPlainObject(value)) {
    // a mapping that isn't there yet: null means "leave it out" here too (a merge-patch deletes it), not `key: null`
    if (!isMap(node)) return createNode(doc, withoutNulls(value));
    const fields = schema?.t === 'object' ? schema.fields : undefined;
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined) {
        node.delete(k);
        continue;
      }
      const pair = node.items.find((it) => (isScalar(it.key) ? it.key.value : it.key) === k);
      if (pair) {
        pair.value = setNode(doc, pair.value, v, prune, fields?.[k]);
        // a patch that deleted everything in a mapping takes the mapping too, rather than leave `key: {}`
        if (isPlainObject(v) && isMap(pair.value) && pair.value.items.length === 0 && !pair.value.commentBefore && !pair.value.comment) node.delete(k);
      }
      else {
        // a new mapping: its nulls mean "leave it out", as they do in one that exists
        const fresh = isPlainObject(v) ? withoutNulls(v) : v;
        if (!isPlainObject(fresh) || Object.keys(fresh).length) node.items.push(new Pair(doc.createNode(k), createNode(doc, fresh)));
      }
    }
    // PUT: keys the schema knows and the body left out go; keys the schema doesn't know stay (they're the user's)
    if (fields) {
      for (const it of [...node.items]) {
        const k = isScalar(it.key) ? String(it.key.value) : String(it.key);
        if (k in fields && !(k in value) && prune(k)) node.delete(k);
      }
    }
    return node;
  }
  if (Array.isArray(value)) {
    if (!isSeq(node)) return createNode(doc, value);
    const of = schema?.t === 'list' ? schema.of : undefined;
    value.forEach((v, i) => {
      node.items[i] = i < node.items.length ? setNode(doc, node.items[i], v, prune, of) : createNode(doc, v);
    });
    node.items.length = value.length;
    return node;
  }
  if (isScalar(node) && node.value === value) return node;
  if (isScalar(node) && typeof node.value === typeof value && node.type !== Scalar.BLOCK_LITERAL && node.type !== Scalar.BLOCK_FOLDED) {
    node.value = value;
    return node;
  }
  // a different kind of value: a new node, carrying the old one's comments
  const fresh = createNode(doc, value);
  if (node && typeof node === 'object') {
    const old = node as Node;
    Object.assign(fresh, { comment: old.comment, commentBefore: old.commentBefore, spaceBefore: old.spaceBefore });
  }
  return fresh;
}

function root(doc: Document): YAMLMap {
  if (doc.contents === null || (isScalar(doc.contents) && doc.contents.value === null)) {
    // an empty file (maybe just comments): give it a mapping, keeping the comments
    const map = new YAMLMap();
    if (isScalar(doc.contents)) map.commentBefore = doc.contents.commentBefore ?? undefined;
    doc.contents = map as never;
  }
  if (!isMap(doc.contents)) throw new Error('the file must be a mapping (key: value lines) at the top level');
  return doc.contents;
}

/** PUT: the file's known keys become exactly `value`'s (null or absent removes them); unknown keys stay. */
export function replaceWith(doc: Document, value: Record<string, unknown>, schema: Field) {
  setNode(doc, root(doc), value, () => true, schema);
}

/** PATCH (JSON merge patch, RFC 7396): mappings merge, null removes a key, anything else replaces. */
export function mergePatch(doc: Document, patch: Record<string, unknown>, schema: Field) {
  setNode(doc, root(doc), patch, () => false, schema);
}

/** Merge-patch the mapping at `key[index]` (one bookmark in `links`), keeping its comments. False if there's none. */
export function patchListItem(doc: Document, key: string, index: number, patch: Record<string, unknown>, schema: Field | undefined): boolean {
  const seq = root(doc).get(key, true);
  if (!isSeq(seq) || index < 0 || index >= seq.items.length || !isMap(seq.items[index])) return false;
  seq.items[index] = setNode(doc, seq.items[index], patch, () => false, schema);
  return true;
}

/** A fresh document for a new file, with optional comment blocks before and after its contents. */
export function newDocument(comments: { header?: string; footer?: string } = {}): Document {
  const doc = new YAML.Document(new YAMLMap());
  if (comments.header) doc.commentBefore = comments.header;
  if (comments.footer) doc.comment = comments.footer;
  return doc;
}

export function stringify(doc: Document): string {
  return doc.toString({ lineWidth: 0 });
}

/** Append `value` to the list at `key` (creating it inline if missing). False if it's already there. */
export function appendToList(doc: Document, key: string, value: unknown): boolean {
  const map = root(doc);
  const seq = map.get(key, true);
  if (seq === undefined || (isScalar(seq) && seq.value === null)) {
    const s = createNode(doc, [value]) as YAMLSeq;
    if (isScalar(seq)) Object.assign(s, { comment: seq.comment, commentBefore: seq.commentBefore });
    map.set(key, s);
    return true;
  }
  if (!isSeq(seq)) throw new Error(`"${key}" must be a list`);
  if (seq.items.some((it) => (isScalar(it) ? it.value : it) === value)) return false;
  seq.items.push(doc.createNode(value));
  return true;
}

/** Append a mapping to the block list at `key` (creating it if missing), e.g. a bookmark to `links:`. */
export function appendMapping(doc: Document, key: string, value: Record<string, unknown>) {
  const map = root(doc);
  const seq = map.get(key, true);
  if (seq === undefined || (isScalar(seq) && seq.value === null)) {
    map.set(key, createNode(doc, [value]));
    return;
  }
  if (!isSeq(seq)) throw new Error(`"${key}" must be a list`);
  // `links: []` is a flow list; a mapping reads better in a block one
  if (seq.flow && !seq.items.length) seq.flow = false;
  seq.items.push(createNode(doc, value));
}

/** Remove item `index` from the list at `key`. False if there's no such item. */
export function removeFromList(doc: Document, key: string, index: number): boolean {
  const seq = root(doc).get(key, true);
  if (!isSeq(seq) || index < 0 || index >= seq.items.length) return false;
  seq.items.splice(index, 1);
  return true;
}
