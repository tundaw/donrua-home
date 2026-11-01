export function deduplicateMemberProfiles(profiles, preferredUid = '') {
  const groups = new Map();
  profiles.forEach((profile) => {
    const emailKey = String(profile.email || '').trim().toLowerCase();
    const key = emailKey || `profile:${profile.id}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { canonical: profile, profileIds: [profile.id] });
      return;
    }

    existing.profileIds.push(profile.id);
    const currentIsPreferred = profile.id === preferredUid || profile.id === profile.uid;
    const existingIsPreferred = existing.canonical.id === preferredUid
      || existing.canonical.id === existing.canonical.uid;
    if (currentIsPreferred && !existingIsPreferred) existing.canonical = profile;
  });

  const members = [];
  const idAliases = {};
  groups.forEach(({ canonical, profileIds }) => {
    members.push(canonical);
    profileIds.forEach((profileId) => {
      idAliases[profileId] = canonical.id;
    });
  });

  return { members, idAliases };
}

export function canonicalizeMemberReferences(records, idAliases) {
  return records.map((record) => ({
    ...record,
    member_id: idAliases[record.member_id] || record.member_id,
  }));
}
