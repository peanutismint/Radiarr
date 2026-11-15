import { useCallback, useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    cast?: any;
    chrome?: any;
  }
}

export interface GoogleCastState {
  isCastAvailable: boolean;
  isCasting: boolean;
  castDeviceName: string | null;
  startCastingStation: (station: {
    id: string;
    name: string;
    channelNumber?: number;
    thumbnailUrl?: string | null;
  }) => void;
  stopCasting: () => void;
  openCastPrompt: () => void;
}

export function useGoogleCast(): GoogleCastState {
  const [isCastAvailable, setIsCastAvailable] = useState<boolean>(false);
  const [isCasting, setIsCasting] = useState<boolean>(false);
  const [castDeviceName, setCastDeviceName] = useState<string | null>(null);
  const castSessionRef = useRef<any>(null);

  useEffect(() => {
    const handleCastApiAvailable = (isAvailable: boolean) => {
      if (!isAvailable || !window.cast?.framework || !window.chrome?.cast) {
        setIsCastAvailable(false);
        return;
      }

      try {
        const castContext = window.cast.framework.CastContext.getInstance();
        castContext.setOptions({
          receiverApplicationId:
            window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
          autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        });

        setIsCastAvailable(true);

        // Update initial session if any
        const currentSession = castContext.getCurrentSession();
        if (currentSession) {
          castSessionRef.current = currentSession;
          setIsCasting(true);
          const receiver = currentSession.getCastDevice();
          setCastDeviceName(receiver?.friendlyName || 'Google Cast Speaker');
        }

        castContext.addEventListener(
          window.cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
          (event: any) => {
            const SessionState = window.cast.framework.SessionState;
            if (
              event.sessionState === SessionState.SESSION_STARTED ||
              event.sessionState === SessionState.SESSION_RESUMED
            ) {
              const session = castContext.getCurrentSession();
              castSessionRef.current = session;
              setIsCasting(true);
              const receiver = session?.getCastDevice();
              setCastDeviceName(receiver?.friendlyName || 'Google Cast Speaker');
            } else if (
              event.sessionState === SessionState.SESSION_ENDED ||
              event.sessionState === SessionState.NO_SESSION
            ) {
              castSessionRef.current = null;
              setIsCasting(false);
              setCastDeviceName(null);
            }
          }
        );
      } catch (err) {
        console.warn('Google Cast initialization error:', err);
      }
    };

    if (window.cast?.framework) {
      handleCastApiAvailable(true);
    } else {
      window.__onGCastApiAvailable = handleCastApiAvailable;
    }

    return () => {
      if (window.__onGCastApiAvailable === handleCastApiAvailable) {
        delete window.__onGCastApiAvailable;
      }
    };
  }, []);

  const openCastPrompt = useCallback(() => {
    if (!window.cast?.framework) return;
    try {
      const castContext = window.cast.framework.CastContext.getInstance();
      void castContext.requestSession();
    } catch (err) {
      console.warn('Failed to open Google Cast session:', err);
    }
  }, []);

  const startCastingStation = useCallback(
    (station: {
      id: string;
      name: string;
      channelNumber?: number;
      thumbnailUrl?: string | null;
    }) => {
      if (!window.cast?.framework || !window.chrome?.cast) return;
      const castContext = window.cast.framework.CastContext.getInstance();
      let session = castContext.getCurrentSession();

      const loadMediaIntoSession = (activeSession: any) => {
        try {
          const origin = window.location.origin;
          const streamUrl = `${origin}/api/stations/${encodeURIComponent(station.id)}/stream.mp3`;

          const mediaInfo = new window.chrome.cast.media.MediaInfo(
            streamUrl,
            'audio/mp3'
          );
          mediaInfo.streamType = window.chrome.cast.media.StreamType.LIVE;

          const metadata = new window.chrome.cast.media.MusicTrackMediaMetadata();
          metadata.title = station.name;
          metadata.artist = `Radiarr • CH ${station.channelNumber || 1}`;
          if (station.thumbnailUrl) {
            const fullArtUrl = station.thumbnailUrl.startsWith('http')
              ? station.thumbnailUrl
              : `${origin}${station.thumbnailUrl}`;
            metadata.images = [new window.chrome.cast.Image(fullArtUrl)];
          }
          mediaInfo.metadata = metadata;

          const request = new window.chrome.cast.media.LoadRequest(mediaInfo);
          request.autoplay = true;

          activeSession.loadMedia(request).then(
            () => {
              castSessionRef.current = activeSession;
              setIsCasting(true);
              const receiver = activeSession.getCastDevice();
              setCastDeviceName(receiver?.friendlyName || 'Google Cast Speaker');
            },
            (err: any) => {
              console.warn('Cast load media error:', err);
            }
          );
        } catch (err) {
          console.warn('Error loading media to Cast session:', err);
        }
      };

      if (!session) {
        castContext.requestSession().then(
          () => {
            const nextSession = castContext.getCurrentSession();
            if (nextSession) {
              loadMediaIntoSession(nextSession);
            }
          },
          (err: any) => {
            console.warn('User cancelled Cast dialog or error:', err);
          }
        );
      } else {
        loadMediaIntoSession(session);
      }
    },
    []
  );

  const stopCasting = useCallback(() => {
    try {
      if (window.cast?.framework) {
        const castContext = window.cast.framework.CastContext.getInstance();
        const session = castContext.getCurrentSession();
        if (session) {
          session.endSession(true);
        }
      }
      castSessionRef.current = null;
      setIsCasting(false);
      setCastDeviceName(null);
    } catch (err) {
      console.warn('Failed to stop casting:', err);
    }
  }, []);

  return {
    isCastAvailable,
    isCasting,
    castDeviceName,
    startCastingStation,
    stopCasting,
    openCastPrompt,
  };
}
