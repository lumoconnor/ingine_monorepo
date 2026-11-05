import type { Condition, DialogueTree, Effect } from './types';
import { Conditions, Effects, checkParam, type ParamSpec } from './registry';

/**
 * Checks a dialogue tree beyond what its TypeScript type can: every `next`
 * and start node exists, every condition/effect is registered and has the
 * right parameters, and every node is reachable. Throws one error listing
 * all problems so a typo in content fails loudly at startup.
 */
export function validateTree(tree: DialogueTree): void {
  const errors: string[] = [];
  const nodes = tree.nodes ?? {};
  const err = (where: string, msg: string) => errors.push(`${where}: ${msg}`);

  const checkRef = (where: string, ref: unknown) => {
    if (ref === null || ref === undefined) return;
    if (typeof ref !== 'string' || !(ref in nodes)) err(where, `unknown node "${String(ref)}"`);
  };
  const checkArgs = (where: string, specs: Record<string, ParamSpec>, obj: Record<string, unknown>, own: string[]) => {
    for (const [k, spec] of Object.entries(specs)) {
      const msg = checkParam(spec, obj[k]);
      if (msg) err(where, `"${k}" ${msg}`);
    }
    for (const k of Object.keys(obj)) if (!own.includes(k) && !(k in specs)) err(where, `unknown parameter "${k}"`);
  };
  const checkConds = (where: string, list: Condition[] | undefined) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) return err(where, '"if" must be a list of conditions');
    list.forEach((c, i) => {
      const w = `${where}.if[${i}]`;
      const def = Conditions[c?.if];
      if (!def) return err(w, `unknown condition "${c?.if}" (known: ${Object.keys(Conditions).join(', ')})`);
      checkArgs(w, def.params, c, ['if', 'not']);
    });
  };
  const checkEffects = (where: string, list: Effect[] | undefined) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) return err(where, '"do" must be a list of effects');
    list.forEach((e, i) => {
      const w = `${where}.do[${i}]`;
      const def = Effects[e?.do];
      if (!def) return err(w, `unknown effect "${e?.do}" (known: ${Object.keys(Effects).join(', ')})`);
      if (def.itemOnly) return err(w, `"${e.do}" only works in an item's "use" list`);
      checkArgs(w, def.params, e, ['do']);
    });
  };

  if (!tree.id) err('tree', 'missing "id"');
  if (!tree.speaker) err('tree', 'missing "speaker"');
  if (Object.keys(nodes).length === 0) err('tree', 'has no nodes');

  const starts: string[] = [];
  if (typeof tree.start === 'string') {
    checkRef('start', tree.start);
    starts.push(tree.start);
  } else if (Array.isArray(tree.start)) {
    tree.start.forEach((r, i) => {
      checkRef(`start[${i}]`, r.node);
      checkConds(`start[${i}]`, r.if);
      starts.push(r.node);
    });
    const last = tree.start[tree.start.length - 1];
    if (!last || last.if) err('start', 'the last rule must have no "if", so a conversation can always start');
  } else err('tree', '"start" must be a node id or a list of rules');

  for (const [id, n] of Object.entries(nodes)) {
    const w = `nodes.${id}`;
    if (typeof n.text !== 'string' || !n.text) err(w, 'missing "text"');
    checkEffects(w, n.do);
    checkRef(`${w}.next`, n.next);
    if (n.choices !== undefined) {
      if (!Array.isArray(n.choices) || n.choices.length === 0) err(w, '"choices" must be a non-empty list');
      else if (n.choices.length > 9) err(w, 'at most 9 choices (number keys 1-9)');
      if (n.next !== undefined) err(w, 'has both "choices" and "next"; use one');
      n.choices?.forEach((c, i) => {
        const cw = `${w}.choices[${i}]`;
        if (typeof c.text !== 'string' || !c.text) err(cw, 'missing "text"');
        checkRef(`${cw}.next`, c.next);
        checkConds(cw, c.if);
        checkEffects(cw, c.do);
      });
    }
  }

  // Unreachable nodes are almost always a typo in a "next".
  const seen = new Set<string>();
  const stack = starts.filter((s) => s in nodes);
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = nodes[id];
    const nexts = [n.next, ...(n.choices ?? []).map((c) => c.next)];
    for (const x of nexts) if (typeof x === 'string' && x in nodes) stack.push(x);
  }
  for (const id of Object.keys(nodes)) if (!seen.has(id)) err(`nodes.${id}`, 'is unreachable');

  if (errors.length) throw new Error(`Dialogue "${tree.id}" is invalid:\n  ${errors.join('\n  ')}`);
}
