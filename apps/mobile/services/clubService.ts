import { supabase } from '../lib/supabase';

export interface OfficerStatus {
  isOfficer: boolean;
  officerClubIds: string[];
}

export async function getUserOfficerStatus(userId: string): Promise<OfficerStatus> {
  const { data } = await supabase
    .from('club_members')
    .select('club_id')
    .eq('user_id', userId)
    .eq('role', 'officer');

  const officerClubIds = (data ?? []).map((row: any) => row.club_id);
  return {
    isOfficer: officerClubIds.length > 0,
    officerClubIds,
  };
}
