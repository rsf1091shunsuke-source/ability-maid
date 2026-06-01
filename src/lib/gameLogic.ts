export type AbilityType =
  | 'spy' | 'marker' | 'seal' | 'blackout'
  | 'reflect' | 'nullify' | 'return' | 'swap'
  | 'handover' | 'decoy' | 'draw' | 'reveal' | 'expose';

export const ABILITY_INFO: Record<AbilityType, {
  name: string; desc: string; count: number; icon: string;
  condition?: string; isLuck?: boolean; isCurse?: boolean;
}> = {
  spy:      { name: '覗き見',   icon: '👁',  desc: '相手の手札を3秒間見る',                              count: 4 },
  marker:   { name: 'マーカー', icon: '📍', desc: '相手の手札1枚の場所を次のターンまで把握できる',         count: 4 },
  seal:     { name: '封じ込め', icon: '🔒', desc: '次のターン相手の手札がシャッフルされない',              count: 4 },
  blackout: { name: '情報封鎖', icon: '🌑', desc: '相手の覗き見・マーカーを無効化する',                   count: 4 },
  reflect:  { name: '反射',     icon: '🛡', desc: '相手の次の能力を跳ね返す',                            count: 4 },
  nullify:  { name: '無効',     icon: '🚫', desc: '相手の次の能力を無効化する',                           count: 4 },
  return:   { name: '返却',     icon: '↩️', desc: '手札1枚を山札に戻す',                                count: 4 },
  swap:     { name: '交換',     icon: '🔄', desc: '手札を全部入れ替える',                               count: 4, condition: '相手の手札が自分より3枚以上多いとき' },
  handover: { name: '手渡し', icon: '🤝', desc: '自分の手札から1枚選んで相手に渡す', count: 4 },
  decoy:    { name: '囮',       icon: '🪤', desc: '次に相手が引くとき1枚指定して引かせない',              count: 4, condition: '相手の手札が3枚以下のとき' },
  draw:     { name: '山引き',   icon: '🎴', desc: '山札からランダムに2枚引く',                           count: 6, isLuck: true },
  reveal:   { name: '全公開',   icon: '🔮', desc: '相手の手札を10秒間全て表向きにする',                  count: 6, isLuck: true },
  expose:   { name: '暴露',     icon: '💀', desc: '【呪い】ペアが揃った瞬間、自分の手札が5秒間相手に公開される', count: 4, isCurse: true },
};

export const JOKER = 'joker';
export type CardType = AbilityType | 'joker';

export function createDeck(): CardType[] {
  const deck: CardType[] = ['joker'];
  for (const [ability, info] of Object.entries(ABILITY_INFO)) {
    for (let i = 0; i < info.count; i++) {
      deck.push(ability as AbilityType);
    }
  }
  return deck;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function dealInitialHands(deck: CardType[]): {
  hand1: CardType[]; hand2: CardType[]; drawDeck: CardType[];
} {
  const shuffled = shuffle(deck);
  const hand1: CardType[] = [];
  const hand2: CardType[] = [];
  const remaining: CardType[] = [];

  for (const card of shuffled) {
    if (card === 'joker') { remaining.push(card); continue; }
    if (hand1.length < 7 && !hand1.includes(card)) {
      hand1.push(card);
    } else if (hand2.length < 7 && !hand2.includes(card)) {
      hand2.push(card);
    } else {
      remaining.push(card);
    }
  }
  return { hand1, hand2, drawDeck: shuffle(remaining) };
}

export function removePairs(hand: CardType[]): CardType[] {
  const result = [...hand];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < result.length; i++) {
      if (result[i] === JOKER) continue;
      for (let j = i + 1; j < result.length; j++) {
        if (result[j] === JOKER) continue;
        if (result[i] === result[j]) {
          result.splice(j, 1);
          result.splice(i, 1);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return result;
}

export function getEarnedAbilities(rawHand: CardType[]): AbilityType[] {
  const earned: AbilityType[] = [];
  const counts: Record<string, number> = {};
  for (const card of rawHand) {
    if (card === JOKER) continue;
    counts[card] = (counts[card] || 0) + 1;
  }
  for (const [card, count] of Object.entries(counts)) {
    const pairs = Math.floor(count / 2);
    for (let i = 0; i < pairs; i++) earned.push(card as AbilityType);
  }
  return earned;
}

export function checkTriple(hand: CardType[]): AbilityType | null {
  const counts: Record<string, number> = {};
  for (const card of hand) {
    if (card === JOKER) continue;
    counts[card] = (counts[card] || 0) + 1;
    if (counts[card] >= 3) return card as AbilityType;
  }
  return null;
}

export function checkCondition(
  ability: AbilityType,
  myHand: CardType[],
  opponentHand: CardType[]
): boolean {
  switch (ability) {
    case 'swap':     return opponentHand.length >= myHand.length + 3;
    case 'disguise': return myHand.includes('joker');
    case 'decoy':    return opponentHand.length <= 3;
    default:         return true;
  }
}
