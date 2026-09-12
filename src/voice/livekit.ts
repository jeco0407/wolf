"use client";

import { Room, RoomEvent, Track, type Participant, type RemoteTrack } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Seat } from "@/engine";
import { seatOfIdentity, type VoiceChannel } from "./permissions";

// 即時語音頻道（LiveKit）。能不能說話完全由伺服器給的權限決定：
// 輪到自己時伺服器開放發佈麥克風，時間到或換人時伺服器收回，麥克風會被自動關掉

export interface VoiceState {
  connected: boolean;
  // 伺服器目前是否允許我說話
  canTalk: boolean;
  micOn: boolean;
  setMic: (on: boolean) => Promise<void>;
  // 正在說話的座位（用來高亮）
  speaking: Seat[];
  // 瀏覽器擋住自動播放時，需要使用者點一下才能聽到別人的聲音
  needsUnlock: boolean;
  unlock: () => void;
}

export type TokenFetcher = (channel: VoiceChannel) => Promise<{ url: string; token: string } | null>;

const OFF: VoiceState = {
  connected: false,
  canTalk: false,
  micOn: false,
  setMic: async () => {},
  speaking: [],
  needsUnlock: false,
  unlock: () => {},
};

export function useVoiceRoom(channel: VoiceChannel, enabled: boolean, roomKey: string, fetchToken: TokenFetcher): VoiceState {
  const roomRef = useRef<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [canTalk, setCanTalk] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [speaking, setSpeaking] = useState<Seat[]>([]);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const fetchRef = useRef(fetchToken);
  useEffect(() => {
    fetchRef.current = fetchToken;
  }, [fetchToken]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    const audio = new Map<string, HTMLMediaElement[]>();

    const syncLocal = () => {
      const lp = room.localParticipant;
      setCanTalk(!!lp.permissions?.canPublish);
      setMicOn(lp.isMicrophoneEnabled);
    };

    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        el.style.display = "none";
        document.body.appendChild(el);
        audio.set(track.sid ?? String(Math.random()), [el]);
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el.remove());
      })
      .on(RoomEvent.ParticipantPermissionsChanged, (_prev, participant: Participant) => {
        if (participant === room.localParticipant) syncLocal();
      })
      .on(RoomEvent.LocalTrackPublished, syncLocal)
      .on(RoomEvent.LocalTrackUnpublished, syncLocal)
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        setSpeaking(speakers.map((p) => seatOfIdentity(p.identity)).filter((s): s is Seat => s !== null));
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsUnlock(!room.canPlaybackAudio))
      .on(RoomEvent.Disconnected, () => {
        setConnected(false);
        setCanTalk(false);
        setMicOn(false);
      });

    void (async () => {
      const creds = await fetchRef.current(channel).catch(() => null);
      if (!creds || cancelled) return;
      try {
        await room.connect(creds.url, creds.token);
        if (cancelled) return;
        setConnected(true);
        setNeedsUnlock(!room.canPlaybackAudio);
        syncLocal();
      } catch {
        setConnected(false);
      }
    })();

    return () => {
      cancelled = true;
      roomRef.current = null;
      void room.disconnect();
      audio.forEach((els) => els.forEach((el) => el.remove()));
      setConnected(false);
      setCanTalk(false);
      setMicOn(false);
      setSpeaking([]);
    };
  }, [channel, enabled, roomKey]);

  const setMic = useCallback(async (on: boolean) => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(on);
    } catch {
      // 權限被收回或使用者拒絕麥克風
    }
    setMicOn(room.localParticipant.isMicrophoneEnabled);
  }, []);

  const unlock = useCallback(() => {
    void roomRef.current?.startAudio().then(() => setNeedsUnlock(false));
  }, []);

  return enabled ? { connected, canTalk, micOn, setMic, speaking, needsUnlock, unlock } : OFF;
}
