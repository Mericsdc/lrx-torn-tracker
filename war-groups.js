// Local, faction-scoped target assignments. Mutations are validated before writing.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

function createWarGroups(dataDir) {
  const file = path.join(dataDir, 'war-groups.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const fail = (message) => { const e = new Error(message); e.status = 400; throw e; };
  const factionKey = (id) => {
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) fail('Invalid faction ID');
    return String(Number(id));
  };
  const get = (id) => {
    const entry = saved[factionKey(id)];
    return structuredClone(entry && Array.isArray(entry.groups) && entry.assignments
      ? entry : { groups: [], assignments: {} });
  };
  function mutate(id, input) {
    const key = factionKey(id);
    const next = get(id);
    const group = next.groups.find((g) => g.id === input.groupId);
    if (input.action === 'create' || input.action === 'rename') {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name || name.length > 40) fail('Group name must be 1–40 characters');
      if (next.groups.some((g) => g.id !== group?.id && g.name.toLowerCase() === name.toLowerCase())) fail('Group name already exists');
      if (input.action === 'create') {
        if (next.groups.length >= 24) fail('Maximum 24 groups per faction');
        next.groups.push({ id: randomUUID(), name });
      } else {
        if (!group) fail('Group not found');
        group.name = name;
      }
    } else if (input.action === 'remove') {
      if (!group) fail('Group not found');
      next.groups = next.groups.filter((g) => g.id !== group.id);
      for (const [player, assigned] of Object.entries(next.assignments)) if (assigned === group.id) delete next.assignments[player];
    } else if (input.action === 'assign') {
      if (input.groupId !== '' && !group) fail('Group not found');
      if (!Array.isArray(input.playerIds) || !input.playerIds.length || input.playerIds.length > 1000) fail('Choose 1–1000 players');
      for (const id of input.playerIds) {
        if (!Number.isSafeInteger(id) || id <= 0) fail('Invalid player ID');
        if (group) next.assignments[id] = group.id;
        else delete next.assignments[id];
      }
    } else fail('Unknown group action');
    const updated = { ...saved, [key]: next };
    fs.writeFileSync(file + '.tmp', JSON.stringify(updated));
    fs.renameSync(file + '.tmp', file);
    saved = updated;
    return get(id);
  }
  function labels(factionIds) {
    const out = {};
    for (const fid of factionIds) {
      const entry = get(fid);
      for (const [id, groupId] of Object.entries(entry.assignments)) {
        const group = entry.groups.find((g) => g.id === groupId);
        if (group) out[id] = group.name;
      }
    }
    return out;
  }
  return { get, mutate, labels };
}
module.exports = { createWarGroups };
