'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, addDoc, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { createDeck, dealInitialHands, getEarnedAbilities, ABILITY_INFO } from '@/lib/gameLogic';
import type { AbilityType } from '@/lib/gameLogic';

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
        exposeTarget: null,
        abilityChallenge: null,
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
    container: { height: '100dvh', overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 24, background: '#0a0a1a' },
    title: { fontSize: 32, fontWeight: 900, textAlign: 'center' as const, color: '#fff' },
    sub: { fontSize: 14, color: 'rgba(255,255,255,0.5)', textAlign: 'center' as const, marginTop: 4 },
    card: { background: '#111126', borderRadius: 16, padding: 24, width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column' as const, gap: 12, border: '1px solid rgba(255,255,255,0.06)' },
    input: { padding: '12px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 16, outline: 'none', width: '100%' },
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
        <p style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>名前を入力</p>
        <input style={s.input} placeholder="あなたの名前" value={name} onChange={e => setName(e.target.value)} />

        <p style={{ fontWeight: 700, fontSize: 15, color: '#fff', marginTop: 8 }}>部屋を作る</p>
        <button style={{ ...s.btn, background: 'linear-gradient(135deg,#e94560,#c0392b)', color: '#fff' }} onClick={handleCreate} disabled={loading}>
          {loading ? '作成中...' : '✦ 新しい部屋を作る'}
        </button>

        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>── または ──</div>

        <p style={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>部屋に参加する</p>
        <input style={s.input} placeholder="ルームコード（例：ABC123）" value={roomCode} onChange={e => setRoomCode(e.target.value)} />
        <button style={{ ...s.btn, background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }} onClick={handleJoin} disabled={loading}>
          {loading ? '参加中...' : '参加する'}
        </button>

        {error && <p style={s.error}>{error}</p>}
      </div>

      {/* 能力一覧 */}
      <button onClick={() => setShowGuide(!showGuide)}
        style={{ ...s.btn, maxWidth: 360, background: 'rgba(155,89,182,0.15)', border: '1px solid rgba(155,89,182,0.3)', color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
        📖 能力カード一覧 {showGuide ? '▲' : '▼'}
      </button>

      {showGuide && (
        <div style={{ width: '100%', maxWidth: 360, background: '#111126', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
          <p style={{ fontWeight: 900, fontSize: 15, marginBottom: 4, color: '#fff' }}>⚡ 能力カード一覧</p>
          {(Object.entries(ABILITY_INFO) as [AbilityType, typeof ABILITY_INFO[AbilityType]][]).map(([key, info]) => (
            <div key={key} style={{
              padding: '10px 14px', borderRadius: 10,
              background: info.isCurse ? 'rgba(229,57,53,0.08)' : info.isLuck ? 'rgba(255,193,7,0.06)' : 'rgba(155,89,182,0.06)',
              border: `1px solid ${info.isCurse ? 'rgba(229,57,53,0.25)' : info.isLuck ? 'rgba(255,193,7,0.2)' : 'rgba(155,89,182,0.2)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 18 }}>{info.icon}</span>
                <span style={{ fontWeight: 700, fontSize: 13, color: '#fff' }}>{info.name}</span>
                {info.isCurse && <span style={{ fontSize: 10, color: '#E53935', background: 'rgba(229,57,53,0.2)', padding: '2px 6px', borderRadius: 4 }}>呪い</span>}
                {info.isLuck && <span style={{ fontSize: 10, color: '#FFC107', background: 'rgba(255,193,7,0.2)', padding: '2px 6px', borderRadius: 4 }}>運</span>}
                {info.condition && <span style={{ fontSize: 10, color: '#4A90E2', background: 'rgba(74,144,226,0.2)', padding: '2px 6px', borderRadius: 4 }}>条件付き</span>}
              </div>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}>{info.desc}</p>
              {info.condition && <p style={{ fontSize: 11, color: '#4A90E2', marginTop: 6 }}>🔒 {info.condition}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
