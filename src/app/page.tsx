'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, addDoc, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { createDeck, dealInitialHands, getEarnedAbilities } from '@/lib/gameLogic';

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showGuide, setShowGuide] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) { setError('名前を入力してください'); return; }
    setLoading(true);
    try {
      const { user } = await signInAnonymously(auth);
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const { hand1, hand2, drawDeck } = dealInitialHands(createDeck());
      const earned1 = getEarnedAbilities(hand1);
      const earned2 = getEarnedAbilities(hand2);
      const gameRef = await addDoc(collection(db, 'abilityMaidGames'), {
        roomCode: code,
        status: 'waiting',
        currentTurn: user.uid,
        winner: null,
        createdAt: Date.now(),
        turnPhase: 'draw_deck',
        sealed: false,
        decoyIndex: null,
        markedIndex: null,
        blackoutActive: false,
        reflectActive: null,
        nullifyActive: null,
        exposeTarget: null,
        players: {
          [user.uid]: { name: name.trim(), hand: hand1, availableAbilities: earned1 }
        },
        playerIds: [user.uid],
        deck: drawDeck,
        hand2,
        hand2Abilities: earned2,
      });
      localStorage.setItem('abilityMaidUid', user.uid);
      router.push(`/game/${gameRef.id}`);
    } catch { setError('エラーが発生しました'); }
    finally { setLoading(false); }
  };

  const handleJoin = async () => {
    if (!name.trim()) { setError('名前を入力してください'); return; }
    if (!roomCode.trim()) { setError('ルームコードを入力してください'); return; }
    setLoading(true);
    try {
      const { user } = await signInAnonymously(auth);
      const q = query(collection(db, 'abilityMaidGames'), where('roomCode', '==', roomCode.toUpperCase()));
      const snap = await getDocs(q);
      if (snap.empty) { setError('部屋が見つかりません'); setLoading(false); return; }
      const gameDoc = snap.docs[0];
      const data = gameDoc.data();
      if (data.status !== 'waiting') { setError('このゲームはすでに始まっています'); setLoading(false); return; }
      const hostId = data.playerIds[0];
      await updateDoc(doc(db, 'abilityMaidGames', gameDoc.id), {
        [`players.${user.uid}`]: {
          name: name.trim(),
          hand: data.hand2,
          availableAbilities: data.hand2Abilities || [],
        },
        playerIds: [hostId, user.uid],
        status: 'playing',
        hand2: null,
        hand2Abilities: null,
      });
      localStorage.setItem('abilityMaidUid', user.uid);
      router.push(`/game/${gameDoc.id}`);
    } catch { setError('エラーが発生しました'); }
    finally { setLoading(false); }
  };

  const s = {
    container: { minHeight: '100dvh', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 24 },
    title: { fontSize: 32, fontWeight: 900, textAlign: 'center' as const },
    sub: { fontSize: 14, color: 'rgba(255,255,255,0.5)', textAlign: 'center' as const, marginTop: 4 },
    card: { background: '#16213e', borderRadius: 16, padding: 24, width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column' as const, gap: 12 },
    input: { padding: '12px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', background: '#0f3460', color: '#fff', fontSize: 16, outline: 'none', width: '100%' },
    btn: { padding: '14px', borderRadius: 10, border: 'none', fontSize: 15, fontWeight: 700, cursor: 'pointer', width: '100%' },
    error: { color: '#ff6b6b', fontSize: 13, textAlign: 'center' as const },
  };

  return (
    <div style={s.container}>
      <div>
        <div style={s.title}>⚡ Ability Maid</div>
        <div style={s.sub}>能力カードで戦うリアルタイムババ抜き</div>
      </div>

      <div style={s.card}>
        <p style={{ fontWeight: 700, fontSize: 18 }}>名前を入力</p>
        <input style={s.input} placeholder="あなたの名前" value={name} onChange={e => setName(e.target.value)} />

        <p style={{ fontWeight: 700, fontSize: 16, marginTop: 8 }}>部屋を作る</p>
        <button style={{ ...s.btn, background: '#e94560', color: '#fff' }} onClick={handleCreate} disabled={loading}>
          {loading ? '作成中...' : '新しい部屋を作る'}
        </button>

        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>── または ──</div>

        <p style={{ fontWeight: 700, fontSize: 16 }}>部屋に参加する</p>
        <input style={s.input} placeholder="ルームコード（例：ABC123）" value={roomCode} onChange={e => setRoomCode(e.target.value)} />
        <button style={{ ...s.btn, background: '#0f3460', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }} onClick={handleJoin} disabled={loading}>
          {loading ? '参加中...' : '参加する'}
        </button>

        {error && <p style={s.error}>{error}</p>}
      </div>

      {/* 能力一覧ボタン */}
      <button onClick={() => setShowGuide(!showGuide)}
        style={{ ...s.btn, maxWidth: 360, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff' }}>
        📖 能力カード一覧を見る
      </button>

      {/* 能力一覧 */}
      {showGuide && (
        <div style={{ width: '100%', maxWidth: 360, background: '#16213e', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontWeight: 900, fontSize: 16, marginBottom: 4 }}>⚡ 能力カード一覧</p>
          {Object.entries(require('@/lib/gameLogic').ABILITY_INFO).map(([key, info]: [string, any]) => (
            <div key={key} style={{
              padding: '10px 14px', borderRadius: 10,
              background: info.isCurse ? 'rgba(229,57,53,0.1)' : info.isLuck ? 'rgba(255,193,7,0.1)' : 'rgba(155,89,182,0.1)',
              border: `1px solid ${info.isCurse ? 'rgba(229,57,53,0.3)' : info.isLuck ? 'rgba(255,193,7,0.3)' : 'rgba(155,89,182,0.3)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 20 }}>{info.icon}</span>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{info.name}</span>
                {info.isCurse && <span style={{ fontSize: 10, background: 'rgba(229,57,53,0.3)', padding: '2px 6px', borderRadius: 4, color: '#ff6b6b' }}>呪い</span>}
                {info.isLuck && <span style={{ fontSize: 10, background: 'rgba(255,193,7,0.3)', padding: '2px 6px', borderRadius: 4, color: '#FFC107' }}>運</span>}
                {info.condition && <span style={{ fontSize: 10, background: 'rgba(74,144,226,0.3)', padding: '2px 6px', borderRadius: 4, color: '#4A90E2' }}>条件付き</span>}
              </div>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{info.desc}</p>
              {info.condition && <p style={{ fontSize: 11, color: '#4A90E2', marginTop: 4 }}>🔒 {info.condition}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
