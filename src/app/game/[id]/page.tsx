'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
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
  exposeTarget: string | null;
  abilityChallenge: {
    ability: AbilityType;
    usedBy: string;
    expiresAt: number;
    intercepted: 'reflect' | 'nullify' | null;
    resolved: boolean;
  } | null;
}

// ── カード表示コンポーネント ──────────────────────────────────
function CardDisplay({ card, faceDown = false, highlighted = false, onClick, badge }: {
  card?: CardType; faceDown?: boolean; highlighted?: boolean;
  onClick?: () => void; badge?: string;
}) {
  const info = card && card !== 'joker' ? ABILITY_INFO[card as AbilityType] : null;
  const borderColor = highlighted ? '#ffd700'
    : faceDown ? 'rgba(255,255,255,0.15)'
    : card === 'joker' ? '#ffd700'
    : info?.isCurse ? '#E53935'
    : info?.isLuck ? '#FFC107'
    : '#9b59b6';
  const bg = faceDown ? 'linear-gradient(135deg,#1a1a4e,#0f3460)'
    : card === 'joker' ? '#3a3a00'
    : info?.isCurse ? 'rgba(229,57,53,0.15)'
    : info?.isLuck ? 'rgba(255,193,7,0.08)'
    : '#2a1a4a';

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button onClick={onClick} style={{
        width: 62, height: 84, borderRadius: 12,
        border: `2px solid ${borderColor}`, background: bg,
        color: '#fff', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 4, cursor: onClick ? 'pointer' : 'default', gap: 2,
        boxShadow: highlighted ? `0 0 12px ${borderColor}` : 'none',
        transition: 'box-shadow 0.2s',
      }}>
        {faceDown ? <span style={{ fontSize: 28 }}>🂠</span>
          : card === 'joker' ? <>
            <span style={{ fontSize: 22 }}>🃏</span>
            <span style={{ fontSize: 9, color: '#ffd700', fontWeight: 900 }}>JOKER</span>
          </> : <>
            <span style={{ fontSize: 20 }}>{info?.icon}</span>
            <span style={{ fontSize: 9, fontWeight: 700, textAlign: 'center', lineHeight: 1.2 }}>{info?.name}</span>
            {info?.isCurse && <span style={{ fontSize: 8, color: '#ff6b6b' }}>呪い</span>}
          </>}
      </button>
      {badge && (
        <span style={{ position: 'absolute', top: -8, right: -8, fontSize: 16 }}>{badge}</span>
      )}
    </div>
  );
}

// ── 引いたカード大表示 ────────────────────────────────────────
function DrawnCardOverlay({ card }: { card: CardType | null }) {
  if (!card) return null;
  const info = card !== 'joker' ? ABILITY_INFO[card as AbilityType] : null;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.75)', pointerEvents: 'none',
    }}>
      <div style={{
        background: info?.isCurse ? 'rgba(229,57,53,0.2)' : info?.isLuck ? 'rgba(255,193,7,0.1)' : 'rgba(155,89,182,0.2)',
        border: `3px solid ${card === 'joker' ? '#ffd700' : info?.isCurse ? '#E53935' : info?.isLuck ? '#FFC107' : '#9b59b6'}`,
        borderRadius: 24, padding: '32px 48px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 72 }}>{card === 'joker' ? '🃏' : info?.icon}</div>
        <div style={{ fontSize: 28, fontWeight: 900, marginTop: 8, color: card === 'joker' ? '#ffd700' : '#fff' }}>
          {card === 'joker' ? 'JOKER' : info?.name}
        </div>
        {info?.isCurse && <div style={{ fontSize: 14, color: '#E53935', marginTop: 4 }}>💀 呪いカード</div>}
      </div>
    </div>
  );
}

// ── メインコンポーネント ──────────────────────────────────────
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
  const [countdown, setCountdown] = useState(0);
  const [revealCard, setRevealCard] = useState<CardType | null>(null);
  const [challengeCountdown, setChallengeCountdown] = useState(0);
  const autoDrawRef = useRef('');
  const challengeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const uid = localStorage.getItem('abilityMaidUid') || '';
    setMyId(uid);
    const unsub = onSnapshot(doc(db, 'abilityMaidGames', id), snap => {
      if (snap.exists()) setGame(snap.data() as GameState);
    });
    return () => unsub();
  }, [id]);

  const showMsg = useCallback((msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 4000);
  }, []);

  const showRevealCard = useCallback(async (cards: CardType[]) => {
    for (const card of cards) {
      setRevealCard(card);
      await new Promise(r => setTimeout(r, 500));
      setRevealCard(null);
      await new Promise(r => setTimeout(r, 100));
    }
  }, []);

  const runCountdown = useCallback(async (sec: number) => {
    for (let i = sec; i > 0; i--) {
      setCountdown(i);
      await new Promise(r => setTimeout(r, 1000));
    }
    setCountdown(0);
  }, []);

  // 自分のターンになったら自動で山札を引く
  useEffect(() => {
    if (!game || !myId || game.status !== 'playing') return;
    const isMyTurn = game.currentTurn === myId;
    const turnPhase = game.turnPhase || 'draw_deck';
    if (!isMyTurn || turnPhase !== 'draw_deck' || processing) return;
    const turnKey = `${myId}-${game.deck.length}`;
    if (autoDrawRef.current === turnKey) return;
    autoDrawRef.current = turnKey;
    const timer = setTimeout(() => autoDrawFromDeck(game), 800);
    return () => clearTimeout(timer);
  }, [game?.currentTurn, game?.turnPhase, game?.deck?.length, myId, processing]);

  // 暴露チェック
  useEffect(() => {
    if (!game || !myId) return;
    if (game.exposeTarget === myId) {
      showMsg('💀 暴露！あなたの手札が相手に5秒間公開されています！');
    }
  }, [game?.exposeTarget, myId]);

  // 能力チャレンジ監視（相手が能力を使おうとしている）
  useEffect(() => {
    if (!game || !myId) return;
    const challenge = game.abilityChallenge;
    if (!challenge || challenge.resolved || challenge.usedBy === myId) return;
    if (challenge.intercepted !== null) return;

    // 相手が能力を使おうとしている → カウントダウン表示
    const remaining = Math.ceil((challenge.expiresAt - Date.now()) / 1000);
    if (remaining <= 0) return;
    setChallengeCountdown(remaining);

    const interval = setInterval(() => {
      const r = Math.ceil((challenge.expiresAt - Date.now()) / 1000);
      if (r <= 0) { clearInterval(interval); setChallengeCountdown(0); }
      else setChallengeCountdown(r);
    }, 200);
    return () => clearInterval(interval);
  }, [game?.abilityChallenge, myId]);

  // 能力チャレンジ解決監視（自分が使った能力の結果を待つ）
  useEffect(() => {
    if (!game || !myId) return;
    const challenge = game.abilityChallenge;
    if (!challenge || challenge.resolved || challenge.usedBy !== myId) return;

    if (challenge.intercepted !== null) {
      // 相手が割り込んだ
      if (challenge.intercepted === 'reflect') showMsg('🛡 反射された！能力が相手に跳ね返った！');
      else showMsg('🚫 無効化された！能力が効かなかった！');
      updateDoc(doc(db, 'abilityMaidGames', id), { abilityChallenge: null });
      return;
    }

    // タイマーで解決
    const delay = challenge.expiresAt - Date.now();
    if (delay <= 0) {
      executeAbilityAfterChallenge(challenge.ability);
      return;
    }
    const timer = setTimeout(() => {
      executeAbilityAfterChallenge(challenge.ability);
    }, delay);
    return () => clearTimeout(timer);
  }, [game?.abilityChallenge?.intercepted, game?.abilityChallenge?.resolved]);

  if (!game) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh' }}>読み込み中...</div>
  );

  const opponentId = game.playerIds.find(pid => pid !== myId) || '';
  const myPlayer = game.players[myId];
  const opponent = game.players[opponentId];
  const isMyTurn = game.currentTurn === myId;
  const turnPhase = game.turnPhase || 'draw_deck';
  const isOpponentExposed = game.exposeTarget === opponentId;
  const challenge = game.abilityChallenge;
  const isChallengingMe = challenge && !challenge.resolved && challenge.usedBy !== myId && challenge.intercepted === null;
  const availableAbilities = myPlayer?.availableAbilities || [];
  const opponentHasAbility = (ability: AbilityType) =>
    (opponent?.availableAbilities || []).includes(ability);

  const checkWin = (myHand: CardType[], oppHand: CardType[]) => {
    if (myHand.length === 0) return { status: 'finished' as const, winner: myId };
    if (oppHand.length === 0) return { status: 'finished' as const, winner: opponentId };
    return {};
  };

  const handlePairFormed = async (
    paired: AbilityType,
    myHand: CardType[],
    oppHand: CardType[],
    extraUpdates: Record<string, unknown> = {}
  ) => {
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
      showMsg(`⚡ ${ABILITY_INFO[paired].icon} ${ABILITY_INFO[paired].name} が使えるようになった！`);
      await updateDoc(doc(db, 'abilityMaidGames', id), {
        [`players.${myId}.hand`]: myHand,
        [`players.${myId}.availableAbilities`]: updatedAbilities,
        [`players.${opponentId}.hand`]: oppHand,
        ...extraUpdates,
        ...checkWin(myHand, oppHand),
      });
    }
  };

  // 山札から自動で引く
  const autoDrawFromDeck = async (currentGame: GameState) => {
    if (processing || !currentGame || currentGame.deck.length === 0) {
      if (currentGame.deck.length === 0) {
        await updateDoc(doc(db, 'abilityMaidGames', id), { turnPhase: 'draw_opponent' });
      }
      return;
    }
    setProcessing(true);
    const drawn = currentGame.deck[0];
    const newDeck = currentGame.deck.slice(1);
    const myHand = currentGame.players[myId]?.hand || [];
    const oppHand = currentGame.players[opponentId]?.hand || [];
    const newMyHand = removePairs([...myHand, drawn]);
    const gained = myHand.length + 1 - newMyHand.length;

    await showRevealCard([drawn]);
    showMsg(`山札から ${drawn === 'joker' ? '🃏 ジョーカー' : `${ABILITY_INFO[drawn as AbilityType]?.icon} ${ABILITY_INFO[drawn as AbilityType]?.name}`} を引いた！`);

    const triple = checkTriple(newMyHand);
    if (triple) {
      const removed = newMyHand.filter(c => c !== triple);
      await handlePairFormed(triple, removed, oppHand, { deck: newDeck, turnPhase: 'draw_opponent' });
      setProcessing(false);
      return;
    }
    if (gained >= 2 && (drawn as string) !== 'joker') {
      await handlePairFormed(drawn as AbilityType, newMyHand, oppHand, { deck: newDeck, turnPhase: 'draw_opponent' });
    } else {
      await updateDoc(doc(db, 'abilityMaidGames', id), {
        [`players.${myId}.hand`]: newMyHand,
        deck: newDeck,
        turnPhase: 'draw_opponent',
        ...checkWin(newMyHand, oppHand),
      });
    }
    setProcessing(false);
  };

  // 相手から引く
  const drawFromOpponent = async (index: number) => {
    if (!isMyTurn || turnPhase !== 'draw_opponent' || processing || selectingDecoy) return;
    if (game.decoyIndex !== null && index === game.decoyIndex) {
      showMsg('🎭 そのカードは囮です！');
      return;
    }
    setProcessing(true);
    const actualCard = opponent.hand[index];
    const newOpponentHand = game.sealed
      ? opponent.hand.filter((_, i) => i !== index)
      : shuffle(opponent.hand.filter((_, i) => i !== index));
    const newMyHand = removePairs([...myPlayer.hand, actualCard]);
    const gained = myPlayer.hand.length + 1 - newMyHand.length;

    await showRevealCard([actualCard]);
    showMsg(`${actualCard === 'joker' ? '🃏 ジョーカー' : `${ABILITY_INFO[actualCard as AbilityType]?.icon} ${ABILITY_INFO[actualCard as AbilityType]?.name}`} を引いた！`);

    // 5秒カウントダウン
    await runCountdown(5);

    const triple = checkTriple(newMyHand);
    if (triple) {
      const removed = newMyHand.filter(c => c !== triple);
      await handlePairFormed(triple, removed, newOpponentHand, {
        currentTurn: opponentId, turnPhase: 'draw_deck', sealed: false, decoyIndex: null,
      });
      setProcessing(false);
      return;
    }
    if (gained >= 2 && (actualCard as string) !== 'joker') {
      await handlePairFormed(actualCard as AbilityType, newMyHand, newOpponentHand, {
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

  // 能力を使う（チャレンジシステム経由）
  const useAbility = async (ability: AbilityType) => {
    if (!checkCondition(ability, myPlayer.hand, opponent?.hand || [])) {
      showMsg(`⚠️ 条件未達成：${ABILITY_INFO[ability].condition}`);
      return;
    }
    // 反射・無効は相手が持っているときチャレンジ発生
    const opponentCanIntercept = opponentHasAbility('reflect') || opponentHasAbility('nullify');
    if (opponentCanIntercept) {
      await updateDoc(doc(db, 'abilityMaidGames', id), {
        abilityChallenge: {
          ability,
          usedBy: myId,
          expiresAt: Date.now() + 4000,
          intercepted: null,
          resolved: false,
        }
      });
      // 自分の availableAbilities から削除
      const newAvail = removeAbilityFromAvailable(ability);
      await updateDoc(doc(db, 'abilityMaidGames', id), {
        [`players.${myId}.availableAbilities`]: newAvail,
      });
      showMsg(`${ABILITY_INFO[ability].icon} ${ABILITY_INFO[ability].name} を使った！相手の応答を待っています...`);
    } else {
      // 直接発動
      const newAvail = removeAbilityFromAvailable(ability);
      await updateDoc(doc(db, 'abilityMaidGames', id), {
        [`players.${myId}.availableAbilities`]: newAvail,
      });
      await executeAbility(ability);
    }
  };

  const removeAbilityFromAvailable = (ability: AbilityType) => {
    const current = [...(myPlayer.availableAbilities || [])];
    const idx = current.indexOf(ability);
    if (idx >= 0) current.splice(idx, 1);
    return current;
  };

  // 実際の能力実行
  const executeAbility = async (ability: AbilityType) => {
    switch (ability) {
      case 'spy':
        if (game.blackoutActive) { showMsg('🌑 情報封鎖で無効化！'); return; }
        setOpponentRevealed(true);
        setTimeout(() => setOpponentRevealed(false), 5000);
        showMsg('👁 覗き見！相手の手札を5秒間見る！');
        break;
      case 'marker':
        if (game.blackoutActive) { showMsg('🌑 情報封鎖で無効化！'); return; }
        showMsg('📍 マーカー！相手の左端をマーク！');
        await updateDoc(doc(db, 'abilityMaidGames', id), { markedIndex: 0 });
        break;
      case 'seal':
        showMsg('🔒 封じ込め！次のターン相手手札シャッフルなし！');
        await updateDoc(doc(db, 'abilityMaidGames', id), { sealed: true });
        break;
      case 'blackout':
        showMsg('🌑 情報封鎖！相手の覗き見・マーカーを無効化！');
        await updateDoc(doc(db, 'abilityMaidGames', id), { blackoutActive: true });
        setTimeout(async () => {
          await updateDoc(doc(db, 'abilityMaidGames', id), { blackoutActive: false });
        }, 10000);
        break;
      case 'return':
        if (myPlayer.hand.length > 0) {
          const jokerIdx = myPlayer.hand.indexOf('joker');
          const idx = jokerIdx >= 0 ? jokerIdx : 0;
          const newHand = myPlayer.hand.filter((_, i) => i !== idx);
          showMsg(`↩️ 返却！${myPlayer.hand[idx] === 'joker' ? 'ジョーカー' : ABILITY_INFO[myPlayer.hand[idx] as AbilityType]?.name}を山札に戻した！`);
          await updateDoc(doc(db, 'abilityMaidGames', id), {
            [`players.${myId}.hand`]: newHand,
            deck: shuffle([...game.deck, myPlayer.hand[idx]]),
          });
        }
        break;
      case 'swap':
        showMsg('🔄 交換！手札を全部入れ替えた！');
        await updateDoc(doc(db, 'abilityMaidGames', id), {
          [`players.${myId}.hand`]: opponent.hand,
          [`players.${opponentId}.hand`]: myPlayer.hand,
        });
        break;
      case 'disguise':
        showMsg('🎭 偽装！ジョーカーが別カードに見せかけられた！');
        break;
      case 'decoy':
        setSelectingDecoy(true);
        showMsg('🪤 囮にするカードを選んでください');
        break;
      case 'draw':
        const drawn2 = game.deck.slice(0, 2);
        await showRevealCard(drawn2);
        const newHand2 = removePairs([...myPlayer.hand, ...drawn2]);
        showMsg('🎴 山引き！2枚引いた！');
        await updateDoc(doc(db, 'abilityMaidGames', id), {
          [`players.${myId}.hand`]: newHand2,
          deck: game.deck.slice(2),
        });
        break;
      case 'reveal':
        setOpponentRevealed(true);
        setTimeout(() => setOpponentRevealed(false), 10000);
        showMsg('🔮 全公開！相手の手札が10秒間見える！');
        break;
    }
    await updateDoc(doc(db, 'abilityMaidGames', id), { abilityChallenge: null });
  };

  const executeAbilityAfterChallenge = async (ability: AbilityType) => {
    await updateDoc(doc(db, 'abilityMaidGames', id), {
      abilityChallenge: { ...game.abilityChallenge, resolved: true }
    });
    await executeAbility(ability);
  };

  // 反射・無効で割り込む（相手のターン中）
  const interceptAbility = async (type: 'reflect' | 'nullify') => {
    if (!challenge) return;
    const newAvail = removeAbilityFromAvailable(type);
    await updateDoc(doc(db, 'abilityMaidGames', id), {
      abilityChallenge: { ...challenge, intercepted: type },
      [`players.${myId}.availableAbilities`]: newAvail,
    });
    setChallengeCountdown(0);
    showMsg(type === 'reflect' ? '🛡 反射！能力を跳ね返した！' : '🚫 無効化！能力を防いだ！');
  };

  const selectDecoyCard = async (index: number) => {
    if (!selectingDecoy) return;
    await updateDoc(doc(db, 'abilityMaidGames', id), { decoyIndex: index });
    setSelectingDecoy(false);
    showMsg(`🪤 ${index + 1}枚目が囮に設定された！`);
  };

  // 終了画面
  if (game.status === 'finished') {
    const iWon = game.winner === myId;
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, background: '#0a0a1a' }}>
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
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, padding: 24, background: '#0a0a1a' }}>
        <div style={{ fontSize: 48 }}>⏳</div>
        <p style={{ fontSize: 20, fontWeight: 700 }}>対戦相手を待っています...</p>
        <div style={{ background: '#16213e', borderRadius: 16, padding: 24, textAlign: 'center' }}>
          <p style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>ルームコードを相手に教えてください</p>
          <p style={{ fontSize: 40, fontWeight: 900, letterSpacing: '0.2em', color: '#ffd700' }}>{game.roomCode}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', padding: 16, gap: 12, maxWidth: 480, margin: '0 auto', paddingBottom: 32, background: '#0a0a1a' }}>

      {/* 引いたカード大表示 */}
      <DrawnCardOverlay card={revealCard} />

      {/* カウントダウン */}
      {countdown > 0 && (
        <div style={{ position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 100, background: 'rgba(0,0,0,0.8)', border: '2px solid #ffd700', borderRadius: 50, width: 60, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 900, color: '#ffd700' }}>
          {countdown}
        </div>
      )}

      {/* 相手が能力を使った → 割り込みプロンプト */}
      {isChallengingMe && (
        <div style={{ position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 150, width: '90%', maxWidth: 420, background: '#1a0a2e', border: '2px solid #9b59b6', borderRadius: 16, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 20 }}>{ABILITY_INFO[challenge!.ability]?.icon}</span>
            <p style={{ fontWeight: 700, fontSize: 14 }}>
              相手が「{ABILITY_INFO[challenge!.ability]?.name}」を使おうとしています！
            </p>
            <span style={{ marginLeft: 'auto', fontSize: 20, color: '#ffd700', fontWeight: 900 }}>{challengeCountdown}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {availableAbilities.includes('reflect') && (
              <button onClick={() => interceptAbility('reflect')}
                style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid #4A90E2', background: 'rgba(74,144,226,0.2)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                🛡 反射する
              </button>
            )}
            {availableAbilities.includes('nullify') && (
              <button onClick={() => interceptAbility('nullify')}
                style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid #E53935', background: 'rgba(229,57,53,0.2)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                🚫 無効化する
              </button>
            )}
            <button onClick={() => setChallengeCountdown(0)}
              style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
              スルー
            </button>
          </div>
        </div>
      )}

      {/* ターン表示 */}
      <div style={{ background: isMyTurn ? '#0a2a0a' : '#2a0a0a', borderRadius: 14, padding: '14px 18px', textAlign: 'center', border: `1px solid ${isMyTurn ? 'rgba(74,222,128,0.3)' : 'rgba(229,57,53,0.3)'}` }}>
        <p style={{ fontWeight: 800, fontSize: 17 }}>
          {isMyTurn ? '🟢 あなたのターン' : `🔴 ${opponent?.name ?? '相手'}のターン`}
        </p>
        {isMyTurn && turnPhase === 'draw_deck' && (
          <p style={{ fontSize: 12, color: '#4ade80', marginTop: 4 }}>山札を自動で引いています...</p>
        )}
        {isMyTurn && turnPhase === 'draw_opponent' && (
          <p style={{ fontSize: 12, color: '#ffd700', marginTop: 4 }}>② 相手の手札からカードを引いてください</p>
        )}
        {message && <p style={{ fontSize: 13, color: '#4fc3f7', marginTop: 6, fontWeight: 600 }}>{message}</p>}
      </div>

      {/* 使える能力（自分のターン中のみ全部使える） */}
      {isMyTurn && availableAbilities.length > 0 && (
        <div style={{ background: '#111126', border: '1px solid rgba(155,89,182,0.4)', borderRadius: 14, padding: 14 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#9b59b6', marginBottom: 10 }}>⚡ 使える能力（タップで発動）</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {availableAbilities.map((ability, i) => {
              const conditionMet = checkCondition(ability, myPlayer.hand, opponent?.hand || []);
              const info = ABILITY_INFO[ability];
              return (
                <button key={i} onClick={() => useAbility(ability)}
                  style={{
                    padding: '8px 14px', borderRadius: 10,
                    border: `1px solid ${conditionMet ? 'rgba(155,89,182,0.6)' : 'rgba(255,255,255,0.1)'}`,
                    background: conditionMet ? 'rgba(155,89,182,0.2)' : 'rgba(255,255,255,0.04)',
                    color: conditionMet ? '#fff' : 'rgba(255,255,255,0.3)',
                    fontSize: 13, fontWeight: 700, cursor: conditionMet ? 'pointer' : 'not-allowed',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                  <span>{info.icon}</span>
                  <span>{info.name}</span>
                  {info.condition && <span style={{ fontSize: 11 }}>{conditionMet ? '✅' : '🔒'}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 囮選択中 */}
      {selectingDecoy && (
        <div style={{ background: '#2a1a0a', border: '1px solid #FFC107', borderRadius: 12, padding: 12 }}>
          <p style={{ fontSize: 13, color: '#FFC107', fontWeight: 700 }}>🪤 囮にするカードをタップしてください</p>
        </div>
      )}

      {/* 相手の手札 */}
      <div style={{ background: '#111126', borderRadius: 14, padding: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <p style={{ fontWeight: 700 }}>{opponent?.name ?? '相手'} の手札</p>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>（{opponent?.hand?.length ?? 0}枚）</span>
          {game.sealed && <span style={{ fontSize: 11, color: '#4fc3f7' }}>🔒</span>}
          {isOpponentExposed && <span style={{ fontSize: 11, color: '#E53935', fontWeight: 700 }}>💀公開中</span>}
        </div>
        {isMyTurn && turnPhase === 'draw_opponent' && !selectingDecoy && (
          <p style={{ fontSize: 12, color: '#ffd700', marginBottom: 8 }}>タップして引く 👇</p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {opponent?.hand?.map((card, i) => {
            const isDecoy = game.decoyIndex === i;
            const isMarked = game.markedIndex === i;
            const reveal = opponentRevealed || isOpponentExposed;
            return (
              <CardDisplay
                key={i}
                card={reveal ? card : undefined}
                faceDown={!reveal}
                highlighted={isMyTurn && turnPhase === 'draw_opponent'}
                onClick={() => drawFromOpponent(i)}
                badge={isDecoy && !reveal ? '🎭' : isMarked && !reveal ? '📍' : undefined}
              />
            );
          })}
        </div>
      </div>

      {/* 山札 */}
      <div style={{ background: '#111126', borderRadius: 14, padding: '12px 16px', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 52, height: 72, borderRadius: 10, background: 'linear-gradient(135deg,#1a1a4e,#0f3460)', border: '1px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>
          🎴
        </div>
        <div>
          <p style={{ fontWeight: 700, fontSize: 14 }}>山札</p>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{game.deck?.length ?? 0}枚残り</p>
          {isMyTurn && turnPhase === 'draw_deck' && (
            <p style={{ fontSize: 11, color: '#4ade80', marginTop: 2 }}>自動で引いています...</p>
          )}
        </div>
      </div>

      {/* 自分の手札 */}
      <div style={{ background: '#111126', borderRadius: 14, padding: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
        <p style={{ marginBottom: 10, fontWeight: 700, fontSize: 14 }}>
          あなたの手札（{myPlayer?.hand?.length ?? 0}枚）
          {selectingDecoy && <span style={{ fontSize: 12, color: '#FFC107', marginLeft: 8 }}>囮を選択中</span>}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {myPlayer?.hand?.map((card, i) => (
            <CardDisplay
              key={i}
              card={card}
              highlighted={selectingDecoy}
              onClick={() => {
                if (selectingDecoy) selectDecoyCard(i);
                else if (card !== 'joker') setSelectedCard(card as AbilityType);
              }}
              badge={game.decoyIndex === i ? '🎭' : undefined}
            />
          ))}
        </div>
      </div>

      {/* カード詳細 */}
      {selectedCard && (
        <div style={{ background: '#1a0a2e', border: '1px solid #9b59b6', borderRadius: 14, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 28 }}>{ABILITY_INFO[selectedCard].icon}</span>
              <div>
                <p style={{ fontWeight: 700, fontSize: 15 }}>{ABILITY_INFO[selectedCard].name}</p>
                {ABILITY_INFO[selectedCard].isCurse && <p style={{ fontSize: 11, color: '#E53935' }}>呪いカード</p>}
                {ABILITY_INFO[selectedCard].isLuck && <p style={{ fontSize: 11, color: '#FFC107' }}>運カード</p>}
              </div>
            </div>
            <button onClick={() => setSelectedCard(null)}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 20 }}>×</button>
          </div>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', lineHeight: 1.6 }}>{ABILITY_INFO[selectedCard].desc}</p>
          {ABILITY_INFO[selectedCard].condition && (
            <p style={{ fontSize: 12, color: '#4A90E2', marginTop: 8 }}>🔒 {ABILITY_INFO[selectedCard].condition}</p>
          )}
        </div>
      )}

      {/* 能力一覧 */}
      <button onClick={() => setShowGuide(!showGuide)}
        style={{ padding: '10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)', fontSize: 13, cursor: 'pointer' }}>
        📖 能力一覧 {showGuide ? '▲' : '▼'}
      </button>

      {showGuide && (
        <div style={{ background: '#111126', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(Object.entries(ABILITY_INFO) as [AbilityType, typeof ABILITY_INFO[AbilityType]][]).map(([key, info]) => (
            <div key={key} style={{
              padding: '10px 12px', borderRadius: 10,
              background: info.isCurse ? 'rgba(229,57,53,0.08)' : info.isLuck ? 'rgba(255,193,7,0.06)' : 'rgba(155,89,182,0.06)',
              border: `1px solid ${info.isCurse ? 'rgba(229,57,53,0.25)' : info.isLuck ? 'rgba(255,193,7,0.2)' : 'rgba(155,89,182,0.2)'}`,
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
