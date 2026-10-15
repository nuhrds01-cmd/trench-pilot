const PREFIXES = [
  "Neon",
  "Turbo",
  "Pixel",
  "Giga",
  "Nano",
  "Feral",
  "Cosmic",
  "Rusty",
  "Sugar",
  "Bolt",
  "Shadow",
  "Lucky",
  "Spicy",
  "Orbit",
  "Frog",
  "Bean",
  "Nova",
  "Chaos",
  "Mint",
  "Wild",
];

const SUFFIXES = [
  "Cat",
  "Dog",
  "Pepe",
  "Fox",
  "Bot",
  "King",
  "Girl",
  "Boy",
  "Ai",
  "Duck",
  "Whale",
  "Rocket",
  "Coin",
  "Fi",
  "Inu",
  "Labs",
  "Punk",
  "Meme",
  "Trenches",
  "Pump",
];

export function randomTokenIdentity(seed: number) {
  const p = PREFIXES[seed % PREFIXES.length];
  const s = SUFFIXES[(seed * 7) % SUFFIXES.length];
  const name = `${p} ${s}`;
  const symbol = `${p.slice(0, 3)}${s.slice(0, 3)}`.toUpperCase();
  return { name, symbol };
}

export function randomMint(seed: number) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let out = "";
  let x = seed ^ 0x9e3779b9;
  for (let i = 0; i < 44; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out += alphabet[x % alphabet.length];
  }
  return out;
}

export function randomWallet(seed: number) {
  return randomMint(seed + 99991).slice(0, 44);
}
