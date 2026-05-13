import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/auth';

type ProfileContextValue = {
  emergencyName: string;
  emergencyChatId: string;
  fallDetectionEnabled: boolean;
  loading: boolean;
  setEmergencyContact: (name: string, chatId: string) => Promise<void>;
  setFallDetectionEnabled: (enabled: boolean) => Promise<void>;
};

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyChatId, setEmergencyChatId] = useState('');
  const [fallDetectionEnabled, setFallEnabled] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setEmergencyName('');
      setEmergencyChatId('');
      setFallEnabled(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    supabase
      .from('profiles')
      .select('emergency_contact_name, emergency_contact_chat_id, fall_detection_enabled')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn('[profile] load failed', error.message);
        } else if (data) {
          setEmergencyName(data.emergency_contact_name ?? '');
          setEmergencyChatId(data.emergency_contact_chat_id ?? '');
          setFallEnabled(data.fall_detection_enabled ?? true);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const upsert = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!user) return;
      const { error } = await supabase
        .from('profiles')
        .upsert(
          { user_id: user.id, updated_at: new Date().toISOString(), ...patch },
          { onConflict: 'user_id' },
        );
      if (error) console.warn('[profile] upsert failed', error.message);
    },
    [user?.id],
  );

  const value = useMemo<ProfileContextValue>(
    () => ({
      emergencyName,
      emergencyChatId,
      fallDetectionEnabled,
      loading,
      setEmergencyContact: async (name, chatId) => {
        setEmergencyName(name);
        setEmergencyChatId(chatId);
        await upsert({ emergency_contact_name: name, emergency_contact_chat_id: chatId });
      },
      setFallDetectionEnabled: async (enabled) => {
        setFallEnabled(enabled);
        await upsert({ fall_detection_enabled: enabled });
      },
    }),
    [emergencyName, emergencyChatId, fallDetectionEnabled, loading, upsert],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used within ProfileProvider');
  return ctx;
}
