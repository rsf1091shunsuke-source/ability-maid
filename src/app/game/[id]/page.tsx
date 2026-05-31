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
}

export default function GamePage() {
  const { id } = useParams<{ id: string }>();
  const [game, setGame] = useState<GameState | null>(null);
  const [myId, setMyId] = useState('');
  const [message, setMessage] = useState('');
  const [opponentRevealed, setOpponentRevealed] = useState(false);
  const [pendingAbility, setPendingAbility] = useState<AbilityType | null>(null);
  const [selectingCard, setSelectingCard] = useState(false);

  useEffect(() => {
    const uid = localStorage.getItem('abilityMaidUid') || '';
    setMyId(uid);
    const unsub = onSnapshot(doc(db, 'abilityMaidGames', id), snap => {
      if (snap.exists()) setGame(snap.data() as GameState);
    });
    return () => unsub();
  }, [id]);

  if (!game) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh' }}>読み込み中...</div>;

  const opponentId = game.playerIds.find(pid => pid !== myId) || '';
  const myPlayer = game.players[myId];
  const opponent = game.players[opponentId];
  const isMyTurn = game.currentTurn === myId;

  const showMsg = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  // ターン終了
  const endTurn = async (updates: Record<string, unknown>) => {
    const nextTurn = game.skipped ? myId : opponentId;
    await updateDoc(doc(db, 'abilityMaidGames', id), {
      ...updates,
      currentTurn: nextTurn,
      skipped: false,
    });
  };

  // 相手の手札からカードを引く
  const drawFromOpponent = async (index: number) => {
    if (!isMyTurn || game.status !== 'playing') return;
    if (selectingCard) return;

    const opponentHand = [...opponent.hand];
    const drawn = opponentHand[index];
    opponentHand.splice(index, 1);

    let newMyHand = removePairs([...myPlayer.hand, drawn]);

    // ジョーカーを引いた場合
    if (drawn === 'joker') {
      showMsg('🃏 ジョーカーを引いた！次のターン開始時に特殊効果発動！');
      await endTurn({
        [`players.${myId}.hand`]: newMyHand,
        [`players.${opponentId}.hand`]: opponentHand,
        jokerEffect: myId,
        ...checkWin(newMyHand, opponentHand, myId, opponentId),
      });
      return;
    }

    showMsg(`${ABILITY_INFO[drawn as AbilityType]?.name ?? drawn} を引きました！`);

    // 3枚揃いチェック
    const triple = checkTriple(newMyHand);
    if (triple) {
      showMsg(`⚡ ${ABILITY_INFO[triple].name} が3枚揃った！強力効果発動！`);
      newMyHand = newMyHand.filter((_, i) => {
        const idx = newMyHand.indexOf(triple);
        return i !== idx;
      }).filter(c => c !== triple);
      await applyTripleAbility(triple, newMyHand, opponentHand);
      return;
    }

    // ペアチェック後に能力発動確認
    const paired = myPlayer.hand.length - newMyHand.length > 0;
    if (paired && drawn !== 'joker') {
      setPendingAbility(drawn as AbilityType);
    }

    await endTurn({
      [`players.${myId}.hand`]: newMyHand,
      [`players.${opponentId}.hand`]: opponentHand,
      ...checkWin(newMyHand, opponentHand, myId, opponentId),
    });
  };

  // 勝敗チェック
  const checkWin = (myHand: CardType[], oppHand: CardType[], myUid: string, oppUid: string) => {
    if (myHand.length === 0) return { status: 'finished', winner: myUid };
    if (oppHand.length === 0) return { status: 'finished', winner: oppUid };
    return {};
  };

  // 3枚能力発動
  const applyTripleAbility = async (ability: AbilityType, myHand: CardType[], oppHand: CardType[]) => {
    if (ability === 'reveal') {
      setOpponentRevealed(true);
      setTimeout(() => setOpponentRevealed(false), 10000);
      await endTurn({ [`players.${myId}.hand`]: myHand, [`players.${opponentId}.hand`]: oppHand });
    } else if (ability === 'reset') {
      const newDeck = shuffle([...oppHand]);
      const newOppHand = newDeck.slice(0, 5);
      await endTurn({
        [`players.${myId}.hand`]: myHand,
        [`players.${opponentId}.hand`]: newOppHand,
        deck: newDeck.slice(5),
      });
    }
  };

  // 2枚能力発動
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
      case 'skip':
        await updateDoc(doc(db, 'abilityMaidGames', id), { skipped: true });
        showMsg('⏭ 相手のターンをスキップ！');
        break;
      case 'swap':
        await updateDoc(doc(db, 'abilityMaidGames', id), {
          [`players.${myId}.hand`]: oppHand,
          [`players.${opponentId}.hand`]: myHand,
        });
        showMsg('🔄 手札を交換した！');
        break;
      case 'draw':
        const drawn2 = game.deck.slice(0, 2);
        const newDeck = game.deck.slice(2);
        const newHand = removePairs([...myHand, ...drawn2]);
        await updateDoc(doc(db, 'abilityMaidGames', id), {
          [`players.${myId}.hand`]: newHand,
          deck: newDeck,
        });
        showMsg('🃏 山札から2枚引いた！');
        break;
    }
    setPendingAbility(null);
  };

  const opponentHandDisplay = opponentRevealed ? opponent?.hand : opponent?.hand?.map(() => 'hidden');

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

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', padding: 16, gap: 12, maxWidth: 480, margin: '0 auto' }}>

      {/* ターン表示 */}
      <div style={{ background: isMyTurn ? '#1a3a1a' : '#3a1a1a', borderRadius: 12, padding: '12px 16px', textAlign: 'center' }}>
        <p style={{ fontWeight: 700, fontSize: 16 }}>
          {isMyTurn ? '🟢 あなたのターン' : `🔴 ${opponent?.name ?? '相手'}のターン`}
        </p>
        {message && <p style={{ fontSize: 13, color: '#ffd700', marginTop: 4 }}>{message}</p>}
      </div>

      {/* 能力発動UI */}
      {pendingAbility && (
        <div style={{ background: '#2a1a4a', border: '1px solid #9b59b6', borderRadius: 12, padding: 16 }}>
          <p style={{ fontWeight: 700, marginBottom: 8 }}>⚡ {ABILITY_INFO[pendingAbility].name} が使えます！</p>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 12 }}>{ABILITY_INFO[pendingAbility].desc}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => useAbility(pendingAbility)} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#9b59b6', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
              発動する
            </button>
            <button onClick={() => setPendingAbility(null)} style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.3)', background: 'transparent', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
              スキップ
            </button>
          </div>
        </div>
      )}

      {/* 相手の手札 */}
      <div style={{ background: '#16213e', borderRadius: 12, padding: 16 }}>
        <p style={{ marginBottom: 12, fontWeight: 700 }}>
          {opponent?.name ?? '相手'} の手札（{opponent?.hand?.length ?? 0}枚）
        </p>
        {isMyTurn && !pendingAbility && (
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>カードをタップして引く</p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {opponentHandDisplay?.map((card, i) => (
            <button key={i} onClick={() => drawFromOpponent(i)}
              style={{ width: 56, height: 76, borderRadius: 8, border: '1px solid rgba(255,255,255,0.3)', background: card === 'hidden' ? 'linear-gradient(135deg,#1a1a4e,#0f3460)' : '#2a1a4a', color: '#fff', fontSize: card === 'hidden' ? 24 : 11, fontWeight: 700, cursor: isMyTurn ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4, textAlign: 'center' }}>
              {card === 'hidden' ? '🂠' : card === 'joker' ? '🃏' : ABILITY_INFO[card as AbilityType]?.name ?? card}
            </button>
          ))}
        </div>
      </div>

      {/* 自分の手札 */}
      <div style={{ background: '#16213e', borderRadius: 12, padding: 16 }}>
        <p style={{ marginBottom: 12, fontWeight: 700 }}>
          あなたの手札（{myPlayer?.hand?.length ?? 0}枚）
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {myPlayer?.hand?.map((card, i) => (
            <div key={i} style={{ width: 56, height: 76, borderRadius: 8, border: `1px solid ${card === 'joker' ? '#ffd700' : '#9b59b6'}`, background: card === 'joker' ? '#3a3a00' : '#2a1a4a', color: card === 'joker' ? '#ffd700' : '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4, textAlign: 'center' }}>
              {card === 'joker' ? '🃏 JOKER' : ABILITY_INFO[card as AbilityType]?.name ?? card}
            </div>
          ))}
        </div>
      </div>

      {/* 山札 */}
      <div style={{ background: '#16213e', borderRadius: 12, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>🎴 山札：</span>
        <span style={{ fontWeight: 700 }}>{game.deck?.length ?? 0}枚</span>
      </div>
    </div>
  );
}
