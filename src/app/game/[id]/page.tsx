'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { removePairs, checkTriple, shuffle, ABILITY_INFO, checkCondition } from '@/lib/gameLogic';
import type { CardType, AbilityType } from '@/lib/gameLogic';

interface Player {
  name: string;
  hand: CardType[];
  availableAbilities: AbilityType[];
}
interface GameState {
  status: 'waiting' | 'playing' | 'finished';
  currentTurn: string;
  winner: string | null;
  playerIds: string[];
  players: Record<string, Player>;
  roomCode: string;
  deck: CardType[];
  turnPhase: 'draw_deck' | 'draw_opponent';
  sealed: boolean;
  decoyIndex: number | null;
  markedIndex: number | null;
  blackoutActive: boolean;
  reflectActive: string | null;
  nullifyActive: string | null;
}

export default function GamePage() {
  const { id } = useParams<{ id: string }>();
  const [game, setGame] = useState<GameState | null>(null);
  const [myId, setMyId] = useState('');
  const [message, setMessage] = useState('');
  const [opponentRevealed, setOpponentRevealed] = useState(false);
  const [pendingAbility, setPendingAbility] = useState<AbilityType | null>(null);
  const [processing, setProcessing] = useState(false);
  const [selectingDecoy, setSelectingDecoy] = useState(false);

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

  const showMsg = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  const checkWin = (myHand: CardType[], oppHand: CardType[]) => {
    if (myHand.length === 0) return { status: 'finished' as const, winner: myId };
    if (oppHand.length === 0) return { status: 'finished' as const, winner: opponentId };
    return {};
  };

  const removeAbilityFromAvailable = async (ability: AbilityType) => {
    const current = myPlayer.availableAbilities || [];
    const idx = current.indexOf(ability);
    if (idx >= 0) {
      const updated = [...current];
      updated.splice(idx, 1);
      await updateDoc(doc(db, 'abilityMaidGames', id), {
        [`players.${myId}.availableAbilities`]: updated,
      });
    }
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

    const triple = checkTriple(newMyHand);
    if (triple) {
      showMsg(`⚡ ${ABILITY_INFO[triple].name} が3枚揃った！`);
      const removed = newMyHand.filter(c => c !== triple);
      await updateDoc(doc(db, 'abilityMaidGames', id), {
        [`players.${myId}.hand`]: removed,
        [`players.${myId}.availableAbilities`]: [...(myPlayer.availableAbilities || []), triple],
        deck: newDeck,
        turnPhase: 'draw_opponent',
        ...checkWin(removed, opponent.hand),
      });
      setProcessing(false);
      return;
    }

    if (gained >= 2 && drawn !== 'joker') {
      const updated = [...(myPlayer.availableAbilities || []), drawn as AbilityType];
      await updateDoc(doc(db, 'abilityMaidGames', id), {
        [`players.${myId}.hand`]: newMyHand,
        [`players.${myId}.availableAbilities`]: updated,
        deck: newDeck,
        turnPhase: 'draw_opponent',
        ...checkWin(newMyHand, opponent.hand),
      });
    } else {
      await updateDoc(doc(db, 'abilityMaidGames', id), {
        [`players.${myId}.hand`]: newMyHand,
        deck: newDeck,
        turnPhase: 'draw_opponent',
        ...checkWin(newMyHand, opponent.hand),
      });
    }
    setProcessing(false);
  };

  // 相手から引く
  const drawFromOpponent = async (index: number) => {
    if (!isMyTurn || turnPhase !== 'draw_opponent' || processing) return;
    if (selectingDecoy) return;
    if (game.decoyIndex !== null && index === game.decoyIndex) {
      showMsg('🎭 そのカードは囮です！別のカードを引いてください');
      return;
    }
    setProcessing(true);

    const actualCard = opponent.hand[index];
    const newOpponentHand = game.sealed
      ? opponent.hand.filter((_, i) => i !== index)
      : shuffle(opponent.hand.filter((_, i) => i !== index));
    const newMyHand = removePairs([...myPlayer.hand, actualCard]);
    const gained = myPlayer.hand.length + 1 - newMyHand.length;

    if (actualCard === 'joker') {
      showMsg('🃏 ジョーカーを引いた！');
    } else {
      showMsg(`${ABILITY_INFO[actualCard as AbilityType]?.name} を引いた！`);
    }

    await new Promise(r => setTimeout(r, 1500));

    const triple = checkTriple(newMyHand);
    if (triple) {
      showMsg(`⚡ ${ABILITY_INFO[triple].name} が3枚揃った！`);
      const removed = newMyHand.filter(c => c !== triple);
      await updateDoc(doc(db, 'abilityMaidGames', id), {
        [`players.${myId}.hand`]: removed,
        [`players.${myId}.availableAbilities`]: [...(myPlayer.availableAbilities || []), triple],
        [`players.${opponentId}.hand`]: newOpponentHand,
        currentTurn: opponentId,
        turnPhase: 'draw_deck',
        sealed: false,
        decoyIndex: null,
        ...checkWin(removed, newOpponentHand),
      });
      setProcessing(false);
      return;
    }

    if (gained >= 2 && (actualCard as string) !== 'joker') {
      const updated = [...(myPlayer.availableAbilities || []), actualCard as AbilityType];
      await updateDoc(doc(db, 'abilityMaidGames', id), {
        [`players.${myId}.hand`]: newMyHand,
        [`players.${myId}.availableAbilities`]: updated,
        [`players.${opponentId}.hand`]: newOpponentHand,
        currentTurn: opponentId,
        turnPhase: 'draw_deck',
        sealed: false,
        decoyIndex: null,
        ...checkWin(newMyHand, newOpponentHand),
      });
    } else {
      await updateDoc(doc(db, 'abilityMaidGames', id), {
        [`players.${myId}.hand`]: newMyHand,
        [`players.${opponentId}.hand`]: newOpponentHand,
        currentTurn: opponentId,
        turnPhase: 'draw_deck',
        sealed: false,
        decoyIndex: null,
        ...checkWin(newMyHand, newOpponentHand),
      });
    }
    setProcessing(false);
  };

  // 能力発動
  const useAbility = async (ability: AbilityType) => {
    if (!checkCondition(ability, myPlayer.hand, opponent.hand)) {
      showMsg(`⚠️ 条件を満たしていません：${ABILITY_INFO[ability].condition}`);
      return;
    }
    await removeAbilityFromAvailable(ability);

    switch (ability) {
      case 'spy':
        if (game.blackoutActive) { showMsg('🚫 情報封鎖で無効化されました！'); return; }
        setOpponentRevealed(true);
        setTimeout(() => setOpponentRevealed(false), 3000);
        showMsg('👁 相手の手札を3秒間見る！');
        break;
      case 'marker':
        if (game.blackoutActive) { showMsg('🚫 情報封鎖で無効化されました！'); return; }
        showMsg(`🔍 マーク：相手の左から${(game.markedIndex ?? 0) + 1}枚目がマークされました`);
        await updateDoc(doc(db, 'abilityMaidGames', id), { markedIndex: 0 });
        break;
      case 'seal':
        await updateDoc(doc(db, 'abilityMaidGames', id), { sealed: true });
        showMsg('🔒 封じ込め！次のターン相手の手札はシャッフルされない！');
        break;
      case 'blackout':
        await updateDoc(doc(db, 'abilityMaidGames', id), { blackoutActive: true });
        showMsg('🌑 情報封鎖！相手の覗き見・マーカーを無効化！');
        setTimeout(async () => {
          await updateDoc(doc(db, 'abilityMaidGames', id), { blackoutActive: false });
        }, 10000);
        break;
      case 'reflect':
        await updateDoc(doc(db, 'abilityMaidGames', id), { reflectActive: myId });
        showMsg('🛡 反射準備完了！相手の次の能力を跳ね返す！');
        break;
      case 'nullify':
        await updateDoc(doc(db, 'abilityMaidGames', id), { nullifyActive: myId });
        showMsg('🚫 無効化準備完了！相手の次の能力を無効化！');
        break;
      case 'return':
        if (myPlayer.hand.length > 0) {
          const jokerIdx = myPlayer.hand.indexOf('joker');
          const idx = jokerIdx >= 0 ? jokerIdx : 0;
          const newHand = myPlayer.hand.filter((_, i) => i !== idx);
          await updateDoc(doc(db, 'abilityMaidGames', id), {
            [`players.${myId}.hand`]: newHand,
            deck: shuffle([...game.deck, myPlayer.hand[idx]]),
          });
          showMsg('↩ カードを山札に戻した！');
        }
        break;
      case 'swap':
        await updateDoc(doc(db, 'abilityMaidGames', id), {
          [`players.${myId}.hand`]: opponent.hand,
          [`players.${opponentId}.hand`]: myPlayer.hand,
        });
        showMsg('🔄 手札を全部入れ替えた！');
        break;
      case 'disguise':
        showMsg('🎭 偽装！相手にはジョーカーが別のカードに見える！');
        await updateDoc(doc(db, 'abilityMaidGames', id), { disguiseActive: true });
        break;
      case 'decoy':
        setSelectingDecoy(true);
        showMsg('🎭 囮にするカードを選んでください（自分の手札）');
        break;
      case 'draw':
        const drawn2 = game.deck.slice(0, 2);
        const newHand2 = removePairs([...myPlayer.hand, ...drawn2]);
        await updateDoc(doc(db, 'abilityMaidGames', id), {
          [`players.${myId}.hand`]: newHand2,
          deck: game.deck.slice(2),
        });
        showMsg('🃏 山札から2枚引いた！');
        break;
      case 'reveal':
        setOpponentRevealed(true);
        setTimeout(() => setOpponentRevealed(false), 10000);
        showMsg('👁 全公開！相手の手札が10秒間見える！');
        break;
    }
    setPendingAbility(null);
  };

  // 囮カード選択
  const selectDecoyCard = async (index: number) => {
    if (!selectingDecoy) return;
    await updateDoc(doc(db, 'abilityMaidGames', id), { decoyIndex: index });
    setSelectingDecoy(false);
    showMsg(`🎭 ${index + 1}枚目のカードが囮に設定された！`);
    await removeAbilityFromAvailable('decoy');
  };

  const availableAbilities = myPlayer?.availableAbilities || [];
  const opponentDisplay = opponentRevealed
    ? opponent?.hand
    : opponent?.hand?.map((_, i) => (game.decoyIndex === i ? 'decoy' : 'hidden'));

  // 終了画面
  if (game.status === 'finished') {
    const iWon = game.winner === myId;
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
        <div style={{ fontSize: 80 }}>{iWon ? '🎉' : '😢'}</div>
        <div style={{ fontSize: 32, fontWeight: 900 }}>{iWon ? 'あなたの勝ち！' : 'あなたの負け...'}</div>
        <button onClick={() => window.location.href = '/'}
          style={{ marginTop: 24, padding: '14px 32px', borderRadius: 12, border: 'none', background: '#e94560', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>
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

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', padding: 16, gap: 12, maxWidth: 480, margin: '0 auto' }}>

      {/* ターン表示 */}
      <div style={{ background: isMyTurn ? '#1a3a1a' : '#3a1a1a', borderRadius: 12, padding: '12px 16px', textAlign: 'center' }}>
        <p style={{ fontWeight: 700, fontSize: 16 }}>
          {isMyTurn ? '🟢 あなたのターン' : `🔴 ${opponent?.name ?? '相手'}のターン`}
        </p>
        {isMyTurn && (
          <p style={{ fontSize: 12, color: '#ffd700', marginTop: 4 }}>
            {turnPhase === 'draw_deck' ? '① 山札からカードを引く' : '② 相手の手札からカードを引く'}
          </p>
        )}
        {message && <p style={{ fontSize: 13, color: '#4fc3f7', marginTop: 4 }}>{message}</p>}
      </div>

      {/* 使える能力一覧 */}
      {availableAbilities.length > 0 && (
        <div style={{ background: '#1a0a2e', border: '1px solid #9b59b6', borderRadius: 12, padding: 12 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#9b59b6', marginBottom: 8 }}>⚡ 使える能力</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {availableAbilities.map((ability, i) => {
              const conditionMet = checkCondition(ability, myPlayer.hand, opponent?.hand || []);
              const info = ABILITY_INFO[ability];
              return (
                <button key={i} onClick={() => useAbility(ability)}
                  style={{
                    padding: '6px 12px', borderRadius: 8, border: `1px solid ${conditionMet ? '#9b59b6' : 'rgba(255,255,255,0.2)'}`,
                    background: conditionMet ? 'rgba(155,89,182,0.2)' : 'rgba(255,255,255,0.05)',
                    color: conditionMet ? '#fff' : 'rgba(255,255,255,0.4)',
                    fontSize: 12, fontWeight: 700, cursor: conditionMet ? 'pointer' : 'not-allowed',
                  }}>
                  {info.name}
                  {info.condition && <span style={{ fontSize: 10, marginLeft: 4 }}>
                    {conditionMet ? '✅' : '🔒'}
                  </span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 囮カード選択中 */}
      {selectingDecoy && (
        <div style={{ background: '#2a1a0a', border: '1px solid #FFC107', borderRadius: 12, padding: 12 }}>
          <p style={{ fontSize: 13, color: '#FFC107', fontWeight: 700 }}>
            🎭 囮にする自分のカードをタップしてください
          </p>
        </div>
      )}

      {/* 相手の手札 */}
      <div style={{ background: '#16213e', borderRadius: 12, padding: 16 }}>
        <p style={{ marginBottom: 8, fontWeight: 700 }}>
          {opponent?.name ?? '相手'} の手札（{opponent?.hand?.length ?? 0}枚）
          {game.sealed && <span style={{ fontSize: 11, color: '#4fc3f7', marginLeft: 8 }}>🔒封じ込め中</span>}
        </p>
        {isMyTurn && turnPhase === 'draw_opponent' && (
          <p style={{ fontSize: 12, color: '#ffd700', marginBottom: 8 }}>タップして引く👇</p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {opponentDisplay?.map((card, i) => (
            <button key={i} onClick={() => drawFromOpponent(i)}
              style={{
                width: 60, height: 80, borderRadius: 10,
                border: `2px solid ${card === 'decoy' ? '#FFC107' : isMyTurn && turnPhase === 'draw_opponent' ? '#ffd700' : 'rgba(255,255,255,0.2)'}`,
                background: card === 'decoy' ? 'rgba(255,193,7,0.1)' : '#0f3460',
                color: '#fff', fontSize: card !== 'hidden' && card !== 'decoy' ? 11 : 24,
                fontWeight: 700, cursor: isMyTurn && turnPhase === 'draw_opponent' ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 4, textAlign: 'center',
              }}>
              {card === 'hidden' ? '🂠'
                : card === 'decoy' ? '🎭'
                : card === 'joker' ? '🃏'
                : ABILITY_INFO[card as AbilityType]?.name}
            </button>
          ))}
        </div>
      </div>

      {/* 山札 */}
      <div style={{ background: '#16213e', borderRadius: 12, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={drawFromDeck}
          disabled={!isMyTurn || turnPhase !== 'draw_deck' || processing}
          style={{
            width: 60, height: 80, borderRadius: 10,
            border: `2px solid ${isMyTurn && turnPhase === 'draw_deck' ? '#4fc3f7' : 'rgba(255,255,255,0.2)'}`,
            background: isMyTurn && turnPhase === 'draw_deck' ? '#0d2137' : '#111',
            color: '#fff', fontSize: 28, cursor: isMyTurn && turnPhase === 'draw_deck' ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: game.deck.length === 0 ? 0.4 : 1,
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
            <div key={i} onClick={() => selectingDecoy ? selectDecoyCard(i) : undefined}
              style={{
                width: 60, height: 80, borderRadius: 10,
                border: `2px solid ${game.decoyIndex === i ? '#FFC107' : card === 'joker' ? '#ffd700' : '#9b59b6'}`,
                background: game.decoyIndex === i ? 'rgba(255,193,7,0.1)' : card === 'joker' ? '#3a3a00' : '#2a1a4a',
                color: '#fff', fontSize: 11, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 4, textAlign: 'center',
                cursor: selectingDecoy ? 'pointer' : 'default',
              }}>
              {card === 'joker' ? '🃏 JOKER' : ABILITY_INFO[card as AbilityType]?.name}
              {game.decoyIndex === i && <span style={{ fontSize: 9, display: 'block' }}>🎭囮</span>}
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
