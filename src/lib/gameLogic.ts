// 能力カードの種類
export type AbilityType =
  | 'spy'        // 覗き見
  | 'steal'      // 強奪
  | 'skip'       // スキップ
  | 'swap'       // 交換
  | 'return'     // 返却
  | 'discard'    // 捨て札
  | 'draw'       // 山引き
  | 'clairvoyance' // 透視
  | 'reflect'    // 反射
  | 'nullify'    // 無効
  | 'reveal'     // 全公開（3枚）
  | 'reset'      // 手札リセット（3枚）

export const ABILITY_INFO: Record<AbilityType, { name: string; desc: string; count: number }> = {
  spy:          { name: '覗き見',     desc: '相手の手札を3秒間見る',                    count: 2 },
  steal:        { name: '強奪',       desc: '相手の手札から1枚選んで奪う',              count: 2 },
  skip:         { name: 'スキップ',   desc: '相手のターンを1回飛ばす',                  count: 2 },
  swap:         { name: '交換',       desc: '自分と相手の手札を全部入れ替える',         count: 2 },
  return:       { name: '返却',       desc: '手札1枚を山札に戻す',                     count: 2 },
  discard:      { name: '捨て札',     desc: '手札から1枚を捨てる',                     count: 2 },
  draw:         { name: '山引き',     desc: '山札から2枚追加で引く',                   count: 2 },
  clairvoyance: { name: '透視',       desc: '山札の上3枚を見て順番を入れ替えられる',   count: 2 },
  reflect:      { name: '反射',       desc: '相手の能力を無効化して跳ね返す',          count: 2 },
  nullify:      { name: '無効',       desc: '相手の能力を無効化する',                  count: 2 },
  reveal:       { name: '全公開',     desc: '相手の手札を10秒間全て表向きにする',      count: 3 },
  reset:        { name: '手札リセット', desc: '相手の手札を全部山札に戻し5枚引き直す', count: 3 },
};

export const JOKER = 'joker';

export type CardType = AbilityType | 'joker';

// デッキを作る
export function createDeck(): CardType[] {
  const deck: CardType[] = [JOKER];
  for (const [ability, info] of Object.entries(ABILITY_INFO)) {
    for (let i = 0; i < info.count; i++) {
      deck.push(ability as AbilityType);
    }
  }
  return deck;
}

// シャッフル
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 2人に配る
export function dealCards(deck: CardType[]): [CardType[], CardType[]] {
  const shuffled = shuffle(deck);
  const mid = Math.ceil(shuffled.length / 2);
  return [shuffled.slice(0, mid), shuffled.slice(mid)];
}

// ペア（同じ能力が2枚以上）を取り除く
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

// 3枚揃っているか確認
export function checkTriple(hand: CardType[]): AbilityType | null {
  const counts: Record<string, number> = {};
  for (const card of hand) {
    if (card === JOKER) continue;
    counts[card] = (counts[card] || 0) + 1;
    if (counts[card] >= 3) return card as AbilityType;
  }
  return null;
}
