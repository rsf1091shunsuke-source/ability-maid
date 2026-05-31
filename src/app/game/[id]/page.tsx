'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { removePairs, checkTriple, shuffle, ABILITY_INFO } from '@/lib/gameLogic';
import type { CardType, AbilityType } from '@/lib/gameLogic';

interface Player { name: string; hand: CardType[]; }
interface GameState {
  status: 'waiting' | 'playing' | 'finished';
  currentTurn: string;
  winner: string | null;
  playerIds: string[];
  players: Record<string, Player>;
  roomCode: string;
  skipped: boolean;
  jokerEffect: string | null;
  deck: CardType[];
  turnPhase: 'draw_deck' | 'draw_opponent';
}

const CARD_STYLE = (color: string, bg: string, cursor = 'default') => ({
  width: 60, height: 80, borderRadius: 10,
  border: `2px solid ${color}`, background: bg,
  color: '#fff', fontSize: 11, fontWeight: 700,
  display: 'flex' as const, alignItems: 'center' as const,
  justifyContent: 'center' as const, padding: 4,
  textAlign: 'center' as const, cursor,
  flexShrink: 0,
});

export default function GamePage() {
  const { id } = useParams<{ id: string }>();
  const [game, setGame] = useState<GameState | null>(null);
  const [myId, setMyId] = useState('');
  const [message, setMessage] = useState('');
  const [opponentRevealed, setOpponentRevealed] = useState(false);
  const [pendingAbility, setPendingAbility] = useState<AbilityType | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const uid = localStorage.getItem('abilityMaidUid') || '';
    setMyId(uid);
    const unsub = onSnapshot(doc(db, 'abilityMaidGames', id), snap => {
      if (snap.exists()) setGame(snap.data() as GameState);
    });
    return () => unsub();
  }, [id]);

  if (!game) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh' }}>
      読み込み中...
    </div>
  );

  const opponentId = game.playerIds.find(pid => pid !== myId) || '';
  const myPlayer = game.players[myId];
  const opponent = game.players[opponentId];
  const isMyTurn = game.currentTurn === myId;
  const turnPhase = game.turnPhase || 'draw_deck';

  const showMsg = (msg: string, duration = 3000) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), duration);
  };

  const checkWin = (myHand: CardType[], oppHand: CardType[]) => {
    if (myHand.length === 0) return { status: 'finished' as const, winner: myId };
    if (oppHand.length === 0) return { status: 'finished' as const, winner: opponentId };
    return {};
  };

  // 山札から引く
  const drawFromDeck = async () => {
    if (!isMyTurn || turnPhase !== 'draw_deck' || processing) return;
    if (game.deck.length === 0) {
      await updateDoc(doc(db, 'abilityMaidGames', id), { turnPhase: 'draw_opponent' });
      return;
    }
    setProcessing(true);
    const drawn = game.deck[0];
    const newDeck = game.deck.slice(1);
    const newMyHand = removePairs([...myPlayer.hand, drawn]);
    const gained = myPlayer.hand.length + 1 - newMyHand.length;

    showMsg(`山札から ${drawn === 'joker' ? '🃏 ジョーカー' : ABILITY_INFO[drawn as AbilityType]?.name} を引いた！`);

    // 3枚揃いチェック
    const triple = checkTriple(newMyHand);
    if (triple) {
      showMsg(`⚡ ${ABILITY_INFO[triple].name} が3枚揃った！`);
      const removed = newMyHand.filter(c => c !== triple);
      await updateDoc(doc(db, 'abilityMaidGames', id), {
        [`players.${myId}.hand`]: removed,
        deck: newDeck,
        turnPhase: 'draw_opponent',
        ...checkWin(removed, opponent.hand),
      });
      setProcessing(false);
      return;
    }

    // ペアで能力発動
    if (gained >= 2 && drawn !== 'joker') {
      setPendingAbility(drawn as AbilityType);
    }

    await updateDoc(doc(db, 'abilityMaidGames', id), {
      [`players.${myId}.hand`]: newMyHand,
      deck: newDeck,
      turnPhase: 'draw_opponent',
      ...checkWin(newMyHand, opponent.hand),
    });
    setProcessing(false);
  };

  // 相手から引く
  const drawFromOpponent = async (index: number) => {
    if (!isMyTurn || turnPhase !== 'draw_opponent' || processing || pendingAbility) return;
    setProcessing(true);

    const actualCard = opponent.hand[index];
    const newOpponentHand = shuffle(opponent.hand.filter((_, i) => i !== index));
    const newMyHand = removePairs([...myPlayer.hand, actualCard]);
    const gained = myPlayer.hand.length + 1 - newMyHand.length;

    if (actualCard === 'joker') {
      showMsg('🃏 ジョーカーを引いた！次のターン強力効果発動！');
    } else {
      showMsg(`${ABILITY_INFO[actualCard as AbilityType]?.name} を引いた！`);
    }

    await new Promise(r => setTimeout(r, 1500));

    // 3枚揃いチェック
    const triple = checkTriple(newMyHand);
    if (triple) {
      showMsg(`⚡ ${ABILITY_INFO[triple].name} が3枚揃った！`);
      const removed = newMyHand.filter(c => c !== triple);
      await updateDoc(doc(db, 'abilityMaidGames', id), {
        [`players.${myId}.hand`]: removed,
        [`players.${opponentId}.hand`]: newOpponentHand,
        currentTurn: opponentId,
        turnPhase: 'draw_deck',
        ...checkWin(removed, newOpponentHand),
      });
      setProcessing(false);
      return;
    }

    // ペアで能力発動
    if (gained >= 2 && actualCard !== 'joker') {
      setPendingAbility(actualCard as AbilityType);
    }

    await updateDoc(doc(db, 'abilityMaidGames', id), {
      [`players.${myId}.hand`]: newMyHand,
      [`players.${opponentId}.hand`]: newOpponentHand,
      currentTurn: opponentId,
      turnPhase: 'draw_deck',
      ...checkWin(newMyHand, newOpponentHand),
    });
    setProcessing(false);
  };

  // 能力発動
  const useAbility = async (ability: AbilityType) => {
    if (!myPlayer || !opponent) return;
    const myHand = [...myPlayer.hand];
    const oppHand = [...opponent.hand];

    switch (ability) {
      case 'spy':
        setOpponentRevealed(true);
        setTimeout(() => setOpponentRevealed(false), 3000);
        showMsg('👁 相手の手札を3秒間見る！');
        break;
      case 'steal':
        showMsg('💰 強奪！相手の手札から1枚選んでください');
        break;
      case 'skip':
        await updateDoc(doc(db, 'abilityMaidGames', id), {
          currentTurn: myId,
          turnPhase: 'draw_deck',
        });
        showMsg('⏭ 相手のターンをスキップ！');
        break;
      case 'swap':
        await updateDoc(doc(db, 'abilityMaidGames', id), {
          [`players.${myId}.hand`]: oppHand,
          [`players.${opponentId}.hand`]: myHand,
        });
        showMsg('🔄 手札を交換した！');
        break;
      case 'return':
        if (myHand.length > 0) {
          const jokerIdx = myHand.indexOf('joker');
          const idx = jokerIdx >= 0 ? jokerIdx : 0;
          const newHand = myHand.filter((_, i) => i !== idx);
          await updateDoc(doc(db, 'abilityMaidGames', id), {
            [`players.${myId}.hand`]: newHand,
            deck: shuffle([...game.deck, myHand[idx]]),
          });
          showMsg('↩ カードを山札に戻した！');
        }
        break;
      case 'discard':
        if (myHand.length > 0) {
          const newHand = myHand.slice(0, -1);
          await updateDoc(doc(db, 'abilityMaidGames', id), {
            [`players.${myId}.hand`]: newHand,
          });
          showMsg('🗑 カードを捨てた！');
        }
        break;
      case 'draw':
        const drawn2 = game.deck.slice(0, 2);
        const newHand2 = removePairs([...myHand, ...drawn2]);
        await updateDoc(doc(db, 'abilityMaidGames', id), {
          [`players.${myId}.hand`]: newHand2,
          deck: game.deck.slice(2),
        });
        showMsg('🃏 山札から2枚引いた！');
        break;
      case 'clairvoyance':
        showMsg(`🔮 山札の上3枚：${game.deck.slice(0, 3).map(c => c === 'joker' ? '🃏' : ABILITY_INFO[c as AbilityType]?.name).join('、')}`);
        break;
      case 'reflect':
        showMsg('🛡 反射を準備！相手の次の能力を跳ね返す');
        break;
      case 'nullify':
        showMsg('🚫 無効化を準備！相手の次の能力を無効にする');
        break;
    }
    setPendingAbility(null);
  };

  // 終了画面
  if (game.status === 'finished') {
    const iWon = game.winner === myId;
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
        <div style={{ fontSize: 80 }}>{iWon ? '🎉' : '😢'}</div>
        <div style={{ fontSize: 32, fontWeight: 900 }}>{iWon ? 'あなたの勝ち！' : 'あなたの負け...'}</div>
        <button onClick={() => window.location.href = '/'} style={{ marginTop: 24, padding: '14px 32px', borderRadius: 12, border: 'none', background: '#e94560', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>
          ホームに戻る
        </button>
      </div>
    );
  }

  // 待機画面
  if (game.status === 'waiting') {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, padding: 24 }}>
        <div style={{ fontSize: 48 }}>⏳</div>
        <p style={{ fontSize: 20, fontWeight: 700 }}>対戦相手を待っています...</p>
        <div style={{ background: '#16213e', borderRadius: 16, padding: 24, textAlign: 'center' }}>
          <p style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>ルームコードを相手に教えてください</p>
          <p style={{ fontSize: 36, fontWeight: 900, letterSpacing: '0.2em', color: '#ffd700' }}>{game.roomCode}</p>
        </div>
      </div>
    );
  }

  const opponentDisplay = opponentRevealed ? opponent?.hand : opponent?.hand?.map(() => 'hidden' as const);

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', padding: 16, gap: 12, maxWidth: 480, margin: '0 auto' }}>

      {/* ターン・フェーズ表示 */}
      <div style={{ background: isMyTurn ? '#1a3a1a' : '#3a1a1a', borderRadius: 12, padding: '12px 16px', textAlign: 'center' }}>
        <p style={{ fontWeight: 700, fontSize: 16 }}>
          {isMyTurn ? '🟢 あなたのターン' : `🔴 ${opponent?.name ?? '相手'}のターン`}
        </p>
        {isMyTurn && (
          <p style={{ fontSize: 12, color: '#ffd700', marginTop: 4 }}>
            {turnPhase === 'draw_deck' ? '① 山札からカードを引いてください' : '② 相手の手札からカードを引いてください'}
          </p>
        )}
        {message && <p style={{ fontSize: 13, color: '#4fc3f7', marginTop: 4 }}>{message}</p>}
      </div>

      {/* 能力発動UI */}
      {pendingAbility && (
        <div style={{ background: '#2a1a4a', border: '2px solid #9b59b6', borderRadius: 12, padding: 16 }}>
          <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
            ⚡ {ABILITY_INFO[pendingAbility].name} が使えます！
          </p>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 12 }}>
            {ABILITY_INFO[pendingAbility].desc}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => useAbility(pendingAbility)}
              style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#9b59b6', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
              発動する
            </button>
            <button onClick={() => setPendingAbility(null)}
              style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.3)', background: 'transparent', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
              スキップ
            </button>
          </div>
        </div>
      )}

      {/* 相手の手札 */}
      <div style={{ background: '#16213e', borderRadius: 12, padding: 16 }}>
        <p style={{ marginBottom: 8, fontWeight: 700 }}>
          {opponent?.name ?? '相手'} の手札（{opponent?.hand?.length ?? 0}枚）
        </p>
        {isMyTurn && turnPhase === 'draw_opponent' && !pendingAbility && (
          <p style={{ fontSize: 12, color: '#ffd700', marginBottom: 8 }}>タップして引く👇</p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {opponentDisplay?.map((card, i) => (
            <button key={i} onClick={() => drawFromOpponent(i)}
              style={{
                ...CARD_STYLE(
                  isMyTurn && turnPhase === 'draw_opponent' ? '#ffd700' : 'rgba(255,255,255,0.2)',
                  '#0f3460',
                  isMyTurn && turnPhase === 'draw_opponent' ? 'pointer' : 'default'
                ),
                fontSize: 24,
              }}>
              {card === 'hidden' ? '🂠' : card === 'joker' ? '🃏' : ABILITY_INFO[card as AbilityType]?.name}
            </button>
          ))}
        </div>
      </div>

      {/* 山札 */}
      <div style={{ background: '#16213e', borderRadius: 12, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={drawFromDeck}
          disabled={!isMyTurn || turnPhase !== 'draw_deck' || processing}
          style={{
            ...CARD_STYLE(
              isMyTurn && turnPhase === 'draw_deck' ? '#4fc3f7' : 'rgba(255,255,255,0.2)',
              isMyTurn && turnPhase === 'draw_deck' ? '#0d2137' : '#111',
              isMyTurn && turnPhase === 'draw_deck' ? 'pointer' : 'default'
            ),
            fontSize: 28, opacity: game.deck.length === 0 ? 0.4 : 1,
          }}>
          🎴
        </button>
        <div>
          <p style={{ fontWeight: 700 }}>山札</p>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>{game.deck?.length ?? 0}枚残り</p>
          {isMyTurn && turnPhase === 'draw_deck' && (
            <p style={{ fontSize: 11, color: '#4fc3f7' }}>← タップして引く</p>
          )}
        </div>
      </div>

      {/* 自分の手札 */}
      <div style={{ background: '#16213e', borderRadius: 12, padding: 16 }}>
        <p style={{ marginBottom: 8, fontWeight: 700 }}>
          あなたの手札（{myPlayer?.hand?.length ?? 0}枚）
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {myPlayer?.hand?.map((card, i) => (
            <div key={i} style={CARD_STYLE(
              card === 'joker' ? '#ffd700' : '#9b59b6',
              card === 'joker' ? '#3a3a00' : '#2a1a4a'
            )}>
              {card === 'joker' ? '🃏 JOKER' : ABILITY_INFO[card as AbilityType]?.name}
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
