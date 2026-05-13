import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';

const CACHE_KEY = 'visiosense_paths_cache';

export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type ObstacleAnnotation = {
  waypointIndex: number;
  label: string;
  zone: 'left' | 'center' | 'right';
  risk: 'low' | 'medium' | 'high';
  distance_m: number;
  capturedAt: number;
};

export type SavedPath = {
  id: string;
  name: string;
  start: Coordinate;
  end: Coordinate;
  waypoints: Coordinate[];
  obstacles: ObstacleAnnotation[];
  createdAt: number;
};

type PathRow = {
  id: string;
  user_id: string;
  name: string;
  start_lat: number;
  start_lng: number;
  end_lat: number;
  end_lng: number;
  waypoints: Coordinate[] | null;
  obstacles: ObstacleAnnotation[] | null;
  created_at: string;
};

function rowToPath(row: PathRow): SavedPath {
  return {
    id: row.id,
    name: row.name,
    start: { latitude: row.start_lat, longitude: row.start_lng },
    end: { latitude: row.end_lat, longitude: row.end_lng },
    waypoints: row.waypoints ?? [],
    obstacles: row.obstacles ?? [],
    createdAt: new Date(row.created_at).getTime(),
  };
}

let memoryCache: SavedPath[] | null = null;
const subscribers = new Set<(paths: SavedPath[]) => void>();

function emit(paths: SavedPath[]) {
  memoryCache = paths;
  for (const cb of subscribers) cb(paths);
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(paths)).catch(() => {});
}

export function subscribePaths(cb: (paths: SavedPath[]) => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

async function fetchFromSupabase(): Promise<SavedPath[]> {
  const { data, error } = await supabase
    .from('paths')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[paths] fetch failed:', error.message);
    throw error;
  }
  return (data ?? []).map((row) => rowToPath(row as PathRow));
}

async function readDiskCache(): Promise<SavedPath[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedPath[];
  } catch {
    return null;
  }
}

/**
 * Returns paths immediately from cache (in-memory > disk), then triggers
 * a background revalidation against Supabase. Subscribers are notified
 * when the revalidation completes with fresh data.
 */
export async function getAllPaths(): Promise<SavedPath[]> {
  if (memoryCache) {
    refreshPaths().catch(() => {});
    return memoryCache;
  }
  const disk = await readDiskCache();
  if (disk) {
    memoryCache = disk;
    refreshPaths().catch(() => {});
    return disk;
  }
  try {
    const fresh = await fetchFromSupabase();
    emit(fresh);
    return fresh;
  } catch {
    return [];
  }
}

export async function refreshPaths(): Promise<SavedPath[]> {
  try {
    const fresh = await fetchFromSupabase();
    emit(fresh);
    return fresh;
  } catch {
    return memoryCache ?? [];
  }
}

export function clearPathCache() {
  memoryCache = null;
  AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
}

export async function savePath(
  name: string,
  start: Coordinate,
  end: Coordinate,
  waypoints: Coordinate[] = [],
  obstacles: ObstacleAnnotation[] = [],
): Promise<SavedPath> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('paths')
    .insert({
      user_id: userId,
      name,
      start_lat: start.latitude,
      start_lng: start.longitude,
      end_lat: end.latitude,
      end_lng: end.longitude,
      waypoints,
      obstacles,
    })
    .select('*')
    .single();

  if (error || !data) throw error ?? new Error('Failed to save path');

  const saved = rowToPath(data as PathRow);
  emit([saved, ...(memoryCache ?? [])]);
  return saved;
}

export async function deletePath(id: string): Promise<void> {
  const { error } = await supabase.from('paths').delete().eq('id', id);
  if (error) throw error;
  emit((memoryCache ?? []).filter((p) => p.id !== id));
}

export async function renamePath(id: string, newName: string): Promise<void> {
  const { error } = await supabase.from('paths').update({ name: newName }).eq('id', id);
  if (error) throw error;
  emit((memoryCache ?? []).map((p) => (p.id === id ? { ...p, name: newName } : p)));
}

export async function getPathById(id: string): Promise<SavedPath | undefined> {
  const fromCache = (memoryCache ?? []).find((p) => p.id === id);
  if (fromCache) return fromCache;

  const { data, error } = await supabase.from('paths').select('*').eq('id', id).single();
  if (error || !data) return undefined;
  return rowToPath(data as PathRow);
}
