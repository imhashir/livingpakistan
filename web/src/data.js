// Loads the static data bundle listed in data/manifest.json.
export async function loadAll(say = () => {}) {
  const base = new URL('data/', document.baseURI);
  const get = async (name) => {
    const r = await fetch(new URL(`${name}.json`, base));
    if (!r.ok) throw new Error(`${name}.json: HTTP ${r.status}`);
    return r.json();
  };
  const { files } = await get('manifest');
  const out = {};
  let n = 0;
  await Promise.all(files.map(async (f) => {
    out[f] = await get(f);
    say(`Loading atlas… ${++n}/${files.length}`);
  }));
  return out;
}
