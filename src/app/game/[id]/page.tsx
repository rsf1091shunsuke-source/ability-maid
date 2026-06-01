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
  exposeTarget: string | null;
}

function CardDisplay({ card, faceDown = false, highlighted = false, onClick, size = 'md' }: {
  card?: CardType; faceDown?: boolean; highlighted?: boolean;
  onClick?: () => void; size?: 'sm' | 'md';
}) {
  const w = size === 'sm' ? 52 : 62;
  const h = size === 'sm' ? 72 : 84;
  const info = card && card !== 'joker' ? ABILITY_INFO[card as AbilityType] : null;
  const isCurse = info?.isCurse;
  const isLuck = info?.isLuck;
  const borderColor = highlighted ? '#ffd700'
    : faceDown ? 'rgba(255,255,255,0.2)'
    : card === 'joker' ? '#ffd700'
    : isCurse ? '#E53935'
    : isLuck ? '#FFC107'
    : '#9b59b6';
  const bg = faceDown ? '#0f3460'
    : card === 'joker' ? '#3a3a00'
    : isCurse ? 'rgba(229,57,53,0.15)'
    : isLuck ? 'rgba(255,193,7,0.1)'
    : '#2a1a4a';

  return (
    <button onClick={onClick} style={{
      width: w, height: h, borderRadius: 10,
      border: `2px solid ${borderColor}`,
      background: bg, color: '#fff',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 4, cursor: onClick ? 'pointer' : 'default',
      gap: 2, flexShrink: 0,
    }}>
      {faceDown ? (
        <span style={{ fontSize: 24 }}>🂠</span>
      ) : card === 'joker' ? (
        <>
          <span style={{ fontSize: 20 }}>🃏</span>
          <span style={{ fontSize: 9, color: '#ffd700', fontWeight: 700 }}>JOKER</span>
        </>
      ) : (
        <>
          <span style={{ fontSize: 18 }}>{info?.icon}</span>
          <span style={{ fontSize: 9, fontWeight: 700, textAlign: 'center', lineHeight: 1.2 }}>{info?.name}</span>
          {isCurse && <span style={{ fontSize: 8, color: '#ff6b6b' }}>呪い</span>}
        </>
      )}
    </button>
  );
}

export default function GamePage() {
  const { id } = useParams<{ id: string }>();
  const [game, setGame] = useState<GameState | null>(null);
  const [myId, setMyId] = useState('');
  const [message, setMessage] = useState('');
  const [opponentRevealed, setOpponentRevealed] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [selectingDecoy, setSelectingDecoy] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [selectedCard, setSelectedCard] = useState<AbilityType | null>(null);

  useEffect(() => {
    const uid = localStorage.getItem('abilityMaidUid') || '';
    setMyId(uid);
    const unsub = onSnapshot(doc(db, 'abilityMaidGames', id), snap => {
      if (snap.exists()) setGame(snap.data() as GameState);
    });
    return () => unsub();
  }, [id]);

  useEffect(() => {
    if (!game || !myId) return;
    // 暴露：相手に自分の手札が公開されている
    if (game.exposeTarget === myId) {
      showMsg('💀 暴露！あなたの手札が相手に5秒間公開されています！');
    }
  }, [game?.exposeTarget]);

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
  const isOpponentExposed = game.exposeTarget === opponentId;

  const showMsg = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  const checkWin = (myHand: CardType[], oppHand: CardType[]) => {
    if (myHand.length === 0) return { status: 'finished' as const, winner: myId };
    if (oppHand.length === 0) return { status: 'finished' as const, winner: opponentId };
    return {};
  };

  const handlePair = async (
    paired: AbilityType,
    myHand: CardType[],
    oppHand: CardType[],
    extraUpdates: Record<string, unknown> = {}
  ) => {
    // 呪いカード：暴露
    if (paired === 'expose') {
      showMsg('💀 暴露発動！あなたの手札が5秒間公開されます！');
      await updateDoc(doc(db, 'abilityMaidGames', id), {
        [`players.${myId}.hand`]: myHand,
        [`players.${opponentId}.hand`]: oppHand,
        exposeTarget: myId,
        ...extraUpdates,
        ...checkWin(myHand, oppHand),
      });
      setTimeout(async () => {
        await updateDoc(doc(db, 'abilityMaidGames', id), { exposeTarget: null });
      }, 5000);
    } else {
      const updatedAbilities = [...(myPlayer.availableAbilities || []), paired];
      showMsg(`⚡ ${ABILITY_INFO[paired].name} が使えるようになった！`);
      await updateDoc(doc(db, 'abilityMaidGames', id), {
        [`players.${myId}.hand`]: myHand,
        [`players.${myId}.availableAbilities`]: updatedAbilities,
        [`players.${opponentId}.hand`]: oppHand,
        ...extraUpdates,
        ...checkWin(myHand, oppHand),
      });
    }
  };

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
    showMsg(`山札から ${drawn === 'joker' ? '🃏 ジョーカー' : ABILITY_INFO[drawn as AbilityType]?.icon + ' ' + ABILITY_INFO[drawn as AbilityType]?.name} を引いた！`);

    const triple = checkTriple(newMyHand);
    if (triple) {
      const removed = newMyHand.filter(c => c !== triple);
      showMsg(`⚡ ${ABILITY_INFO[triple].name} が3枚揃った！`);
      await handlePair(triple, removed, opponent.hand, { deck: newDeck, turnPhase: 'draw_opponent' });
      setProcessing(false);
      return;
    }
    if (gained >= 2 && (drawn as string) !== 'joker') {
      await handlePair(drawn as AbilityType, newMyHand, opponent.hand, { deck: newDeck, turnPhase: 'draw_opponent' });
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

  const drawFromOpponent = async (index: number) => {
    if (!isMyTurn || turnPhase !== 'draw_opponent' || processing || selectingDecoy) return;
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

    showMsg(`${actualCard === 'joker' ? '🃏 ジョーカー' : ABILITY_INFO[actualCard as AbilityType]?.icon + ' ' + ABILITY_INFO[actualCard as AbilityType]?.name} を引いた！`);
    await new Promise(r => setTimeout(r, 1500));

    const triple = checkTriple(newMyHand);
    if (triple) {
      const removed = newMyHand.filter(c => c !== triple);
      showMsg(`⚡ ${ABILITY_INFO[triple].name} が3枚揃った！`);
      await handlePair(triple, removed, newOpponentHand, {
        currentTurn: opponentId, turnPhase: 'draw_deck', sealed: false, decoyIndex: null,
      });
      setProcessing(false);
      return;
    }
    if (gained >= 2 && (actualCard as string) !== 'joker') {
      await handlePair(actualCard as AbilityType, newMyHand, newOpponentHand, {
        currentTurn: opponentId, turnPhase: 'draw_deck', sealed: false, decoyIndex: null,
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

  const removeAbilityFromAvailable = (ability: AbilityType) => {
    const current = [...(myPlayer.availableAbilities || [])];
    const idx = current.indexOf(ability);
    if (idx >= 0) current.splice(idx, 1);
    return current;
  };

  const useAbility = async (ability: AbilityType) => {
    if (!checkCondition(ability, myPlayer.hand, opponent?.hand || [])) {
      showMsg(`⚠️ 条件未達成：${ABILITY_INFO[ability].condition}`);
      return;
    }
    const newAvailable = removeAbilityFromAvailable(ability);
    switch (ability) {
      case 'spy':
        if (game.blackoutActive) { showMsg('🌑 情報封鎖で無効化された！'); return; }
        setOpponentRevealed(true);
        setTimeout(() => setOpponentRevealed(false), 3000);
        showMsg('👁 覗き見！相手の手札を3秒間見る！');
        await updateDoc(doc(db, 'abilityMaidGames', id), { [`players.${myId}.availableAbilities`]: newAvailable });
        break;
      case 'marker':
        if (game.blackoutActive) { showMsg('🌑 情報封鎖で無効化された！'); return; }
        showMsg('📍 マーカー！相手の左端のカードをマーク！');
        await updateDoc(doc(db, 'abilityMaidGames', id), { markedIndex: 0, [`players.${myId}.availableAbilities`]: newAvailable });
        break;
      case 'seal':
        showMsg('🔒 封じ込め！次のターン相手の手札はシャッフルされない！');
        await updateDoc(doc(db, 'abilityMaidGames', id), { sealed: true, [`players.${myId}.availableAbilities`]: newAvailable });
        break;
      case 'blackout':
        showMsg('🌑 情報封鎖！相手の覗き見・マーカーを無効化！');
        await updateDoc(doc(db, 'abilityMaidGames', id), { blackoutActive: true, [`players.${myId}.availableAbilities`]: newAvailable });
        setTimeout(async () => { await updateDoc(doc(db, 'abilityMaidGames', id), { blackoutActive: false }); }, 10000);
        break;
      case 'reflect':
        showMsg('🛡 反射準備完了！相手の次の能力を跳ね返す！');
        await updateDoc(doc(db, 'abilityMaidGames', id), { reflectActive: myId, [`players.${myId}.availableAbilities`]: newAvailable });
        break;
      case 'nullify':
        showMsg('🚫 無効化準備完了！相手の次の能力を無効化！');
        await updateDoc(doc(db, 'abilityMaidGames', id), { nullifyActive: myId, [`players.${myId}.availableAbilities`]: newAvailable });
        break;
      case 'return':
        if (myPlayer.hand.length > 0) {
          const jokerIdx = myPlayer.hand.indexOf('joker');
          const idx = jokerIdx >= 0 ? jokerIdx : 0;
          const newHand = myPlayer.hand.filter((_, i) => i !== idx);
          showMsg(`↩️ 返却！${myPlayer.hand[idx] === 'joker' ? '🃏ジョーカー' : ABILITY_INFO[myPlayer.hand[idx] as AbilityType]?.name}を山札に戻した！`);
          await updateDoc(doc(db, 'abilityMaidGames', id), {
            [`players.${myId}.hand`]: newHand,
            [`players.${myId}.availableAbilities`]: newAvailable,
            deck: shuffle([...game.deck, myPlayer.hand[idx]]),
          });
        }
        break;
      case 'swap':
        showMsg('🔄 交換！手札を全部入れ替えた！');
        await updateDoc(doc(db, 'abilityMaidGames', id), {
          [`players.${myId}.hand`]: opponent.hand,
          [`players.${opponentId}.hand`]: myPlayer.hand,
          [`players.${myId}.availableAbilities`]: newAvailable,
        });
        break;
      case 'disguise':
        showMsg('🎭 偽装！ジョーカーが別のカードに見せかけられた！');
        await updateDoc(doc(db, 'abilityMaidGames', id), { [`players.${myId}.availableAbilities`]: newAvailable });
        break;
      case 'decoy':
        setSelectingDecoy(true);
        showMsg('🪤 囮にする自分のカードを選んでください');
        await updateDoc(doc(db, 'abilityMaidGames', id), { [`players.${myId}.availableAbilities`]: newAvailable });
        break;
      case 'draw':
        const drawn2 = game.deck.slice(0, 2);
        const newHand2 = removePairs([...myPlayer.hand, ...drawn2]);
        showMsg('🎴 山引き！山札から2枚引いた！');
        await updateDoc(doc(db, 'abilityMaidGames', id), {
          [`players.${myId}.hand`]: newHand2,
          [`players.${myId}.availableAbilities`]: newAvailable,
          deck: game.deck.slice(2),
        });
        break;
      case 'reveal':
        setOpponentRevealed(true);
        setTimeout(() => setOpponentRevealed(false), 10000);
        showMsg('🔮 全公開！相手の手札が10秒間見える！');
        await updateDoc(doc(db, 'abilityMaidGames', id), { [`players.${myId}.availableAbilities`]: newAvailable });
        break;
    }
  };

  const selectDecoyCard = async (index: number) => {
    if (!selectingDecoy) return;
    await updateDoc(doc(db, 'abilityMaidGames', id), { decoyIndex: index });
    setSelectingDecoy(false);
    showMsg(`🪤 ${index + 1}枚目のカードが囮に設定された！`);
  };

  const availableAbilities = myPlayer?.availableAbilities || [];

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
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', padding: 16, gap: 12, maxWidth: 480, margin: '0 auto', paddingBottom: 32 }}>

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

      {/* 使える能力 */}
      {availableAbilities.length > 0 && (
        <div style={{ background: '#1a0a2e', border: '1px solid #9b59b6', borderRadius: 12, padding: 12 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#9b59b6', marginBottom: 8 }}>⚡ 使える能力（タップで発動）</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {availableAbilities.map((ability, i) => {
              const conditionMet = checkCondition(ability, myPlayer.hand, opponent?.hand || []);
              const info = ABILITY_INFO[ability];
              return (
                <button key={i} onClick={() => useAbility(ability)}
                  style={{
                    padding: '8px 12px', borderRadius: 8,
                    border: `1px solid ${conditionMet ? '#9b59b6' : 'rgba(255,255,255,0.15)'}`,
                    background: conditionMet ? 'rgba(155,89,182,0.25)' : 'rgba(255,255,255,0.05)',
                    color: conditionMet ? '#fff' : 'rgba(255,255,255,0.35)',
                    fontSize: 13, fontWeight: 700,
                    cursor: conditionMet ? 'pointer' : 'not-allowed',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                  <span>{info.icon}</span>
                  <span>{info.name}</span>
                  {info.condition && <span style={{ fontSize: 10 }}>{conditionMet ? '✅' : '🔒'}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 囮選択中 */}
      {selectingDecoy && (
        <div style={{ background: '#2a1a0a', border: '1px solid #FFC107', borderRadius: 12, padding: 12 }}>
          <p style={{ fontSize: 13, color: '#FFC107', fontWeight: 700 }}>🪤 囮にする自分のカードをタップしてください</p>
        </div>
      )}

      {/* 相手の手札 */}
      <div style={{ background: '#16213e', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <p style={{ fontWeight: 700 }}>{opponent?.name ?? '相手'} の手札（{opponent?.hand?.length ?? 0}枚）</p>
          {game.sealed && <span style={{ fontSize: 11, color: '#4fc3f7' }}>🔒封</span>}
          {isOpponentExposed && <span style={{ fontSize: 11, color: '#E53935', fontWeight: 700 }}>💀公開中</span>}
        </div>
        {isMyTurn && turnPhase === 'draw_opponent' && !selectingDecoy && (
          <p style={{ fontSize: 12, color: '#ffd700', marginBottom: 8 }}>タップして引く👇</p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {opponent?.hand?.map((card, i) => {
            const isDecoy = game.decoyIndex === i;
            const isMarked = game.markedIndex === i;
            const reveal = opponentRevealed || isOpponentExposed;
            return (
              <div key={i} style={{ position: 'relative' }}>
                <CardDisplay
                  card={reveal ? card : undefined}
                  faceDown={!reveal}
                  highlighted={(isMyTurn && turnPhase === 'draw_opponent') || isMarked}
                  onClick={() => drawFromOpponent(i)}
                />
                {isDecoy && !reveal && (
                  <span style={{ position: 'absolute', top: -6, right: -6, fontSize: 14 }}>🎭</span>
                )}
                {isMarked && !reveal && (
                  <span style={{ position: 'absolute', top: -6, left: -6, fontSize: 14 }}>📍</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 山札 */}
      <div style={{ background: '#16213e', borderRadius: 12, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={drawFromDeck}
          disabled={!isMyTurn || turnPhase !== 'draw_deck' || processing}
          style={{
            width: 62, height: 84, borderRadius: 10,
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
        <p style={{ marginBottom: 8, fontWeight: 700 }}>あなたの手札（{myPlayer?.hand?.length ?? 0}枚）</p>
        {selectingDecoy && <p style={{ fontSize: 12, color: '#FFC107', marginBottom: 8 }}>囮にするカードをタップ👇</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {myPlayer?.hand?.map((card, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <CardDisplay
                card={card}
                highlighted={game.decoyIndex === i || selectingDecoy}
                onClick={selectingDecoy ? () => selectDecoyCard(i) : () => setSelectedCard(card !== 'joker' ? card as AbilityType : null)}
              />
              {game.decoyIndex === i && (
                <span style={{ position: 'absolute', top: -6, right: -6, fontSize: 14 }}>🎭</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* カード詳細 */}
      {selectedCard && (
        <div style={{ background: '#1a0a2e', border: '1px solid #9b59b6', borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 24 }}>{ABILITY_INFO[selectedCard].icon}</span>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{ABILITY_INFO[selectedCard].name}</span>
            </div>
            <button onClick={() => setSelectedCard(null)}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 18 }}>×</button>
          </div>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>{ABILITY_INFO[selectedCard].desc}</p>
          {ABILITY_INFO[selectedCard].condition && (
            <p style={{ fontSize: 12, color: '#4A90E2', marginTop: 8 }}>🔒 {ABILITY_INFO[selectedCard].condition}</p>
          )}
          {ABILITY_INFO[selectedCard].isCurse && (
            <p style={{ fontSize: 12, color: '#E53935', marginTop: 8 }}>⚠️ 呪いカード：ペアが揃うと自動発動</p>
          )}
        </div>
      )}

      {/* 能力一覧ボタン */}
      <button onClick={() => setShowGuide(!showGuide)}
        style={{ padding: '10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', fontSize: 13, cursor: 'pointer' }}>
        📖 能力一覧 {showGuide ? '▲' : '▼'}
      </button>

      {/* 能力一覧 */}
      {showGuide && (
        <div style={{ background: '#16213e', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(Object.entries(ABILITY_INFO) as [AbilityType, typeof ABILITY_INFO[AbilityType]][]).map(([key, info]) => (
            <div key={key} style={{
              padding: '10px 12px', borderRadius: 10,
              background: info.isCurse ? 'rgba(229,57,53,0.1)' : info.isLuck ? 'rgba(255,193,7,0.08)' : 'rgba(155,89,182,0.08)',
              border: `1px solid ${info.isCurse ? 'rgba(229,57,53,0.3)' : info.isLuck ? 'rgba(255,193,7,0.2)' : 'rgba(155,89,182,0.2)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 18 }}>{info.icon}</span>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{info.name}</span>
                {info.isCurse && <span style={{ fontSize: 10, color: '#E53935' }}>呪い</span>}
                {info.isLuck && <span style={{ fontSize: 10, color: '#FFC107' }}>運</span>}
                {info.condition && <span style={{ fontSize: 10, color: '#4A90E2' }}>条件付き</span>}
              </div>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>{info.desc}</p>
              {info.condition && <p style={{ fontSize: 11, color: '#4A90E2', marginTop: 4 }}>🔒 {info.condition}</p>}
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
