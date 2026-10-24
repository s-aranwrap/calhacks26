/**
 * User-initiated file operations: exporting history as JSON and picking a
 * CSV/JSON file of activities to import. Nothing here runs automatically.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** Writes the export to a cache file and opens the share sheet; falls back to sharing text. */
export async function shareJson(fileName: string, json: string): Promise<'shared' | 'shared_as_text'> {
  try {
    if (await Sharing.isAvailableAsync()) {
      const file = new File(Paths.cache, fileName);
      file.create({ overwrite: true });
      file.write(json);
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: 'Export Huddle history',
        UTI: 'public.json',
      });
      return 'shared';
    }
  } catch {
    // Fall through to plain-text sharing.
  }
  await Share.share({ message: json, title: fileName });
  return 'shared_as_text';
}

export type PickedFile = { name: string; text: string } | { canceled: true } | { error: string };

export async function pickActivityFile(): Promise<PickedFile> {
  try {
    const result = await File.pickFileAsync({
      mimeTypes: [
        'text/csv',
        'text/comma-separated-values',
        'application/json',
        'text/plain',
        'application/octet-stream',
      ],
    });
    if (result.canceled) return { canceled: true };
    const file = result.result;
    if (file.size > MAX_IMPORT_BYTES) return { error: 'That file is larger than 5 MB.' };
    return { name: file.name, text: await file.text() };
  } catch (error) {
    return { error: (error as Error)?.message ?? 'Could not read the file.' };
  }
}
