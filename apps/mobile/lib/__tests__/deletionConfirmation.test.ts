import { describe, expect, it } from 'vitest';
import {
  DELETE_CONFIRMATION_WORD,
  isDeletionConfirmed,
} from '../deletionConfirmation';

// The typed-DELETE gate is the last thing standing between a tap and a
// permanent, unrecoverable deletion, so it gets its own tests rather than
// relying on the screen that renders it.
describe('isDeletionConfirmed', () => {
  it('accepts the exact word', () => {
    expect(isDeletionConfirmed('DELETE')).toBe(true);
  });

  it('tolerates casing and surrounding whitespace', () => {
    // Autocapitalize and mobile keyboards routinely add these; a user who
    // clearly typed the word should not be told they did not.
    for (const input of ['delete', 'Delete', '  DELETE  ', '\tdelete\n']) {
      expect(isDeletionConfirmed(input)).toBe(true);
    }
  });

  it('rejects anything that is not the word', () => {
    for (const input of [
      '',
      ' ',
      'DELET',
      'DELETES',
      'DELETE ACCOUNT',
      'delete my account',
      'D E L E T E',
      'yes',
      'confirm',
    ]) {
      expect(isDeletionConfirmed(input)).toBe(false);
    }
  });

  it('exports the word the UI must prompt for, so copy cannot drift', () => {
    expect(DELETE_CONFIRMATION_WORD).toBe('DELETE');
    expect(isDeletionConfirmed(DELETE_CONFIRMATION_WORD)).toBe(true);
  });
});
