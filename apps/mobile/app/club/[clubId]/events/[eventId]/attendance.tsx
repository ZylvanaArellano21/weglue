import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, FlatList, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { useAuthStore } from '@weglue/shared';
import { supabase } from '../../../../../lib/supabase';
import { useOfficerStore } from '../../../../../store/officerStore';
import { useToast } from '../../../../../components/Toast';

// ─── Event attendance (event ⋯ → Attendance) ────────────────────────────────
// Officers/advisors only. Shows the event's check-in roster — Student ID and
// school email ONLY, never names or check-in timestamps — plus Export
// (PDF/CSV). No open/close/extend controls in V1.

export type EventAttendanceParams = { clubId: string; eventId: string };

interface AttendanceRow {
  student_id: string;
  school_email: string;
}

interface EventHeader {
  club_name: string;
  title: string;
  event_date: string;
  start_time: string;
  end_time: string;
}

const CREAM = '#FEFCF0';
const TEAL = '#0FA6A6';
const INK = '#1A1A1A';
const MUTED = '#5F5D5D';

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function slugify(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

export default function EventAttendanceScreen() {
  const { clubId, eventId } = useLocalSearchParams<EventAttendanceParams>();
  const router = useRouter();
  const { session } = useAuthStore();
  const { officerClubIds } = useOfficerStore();
  const isOfficer = !!clubId && officerClubIds.includes(clubId);
  const { show, ToastComponent } = useToast();

  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [header, setHeader] = useState<EventHeader | null>(null);
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!isOfficer || !eventId) return;
    let cancelled = false;
    (async () => {
      const [{ data: eventRow, error: eventError }, { data: attendance, error: attendanceError }] = await Promise.all([
        supabase
          .from('events')
          .select('title, event_date, start_time, end_time, clubs!inner(name)')
          .eq('id', eventId)
          .maybeSingle(),
        supabase.rpc('list_event_attendance', { p_event_id: eventId }),
      ]);
      if (cancelled) return;
      if (eventError || !eventRow || attendanceError) {
        setPhase('error');
        return;
      }
      setHeader({
        club_name: (eventRow as any).clubs.name,
        title: (eventRow as any).title,
        event_date: (eventRow as any).event_date,
        start_time: (eventRow as any).start_time,
        end_time: (eventRow as any).end_time,
      });
      setRows((attendance ?? []) as AttendanceRow[]);
      setPhase('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [isOfficer, eventId]);

  async function exportPdf() {
    if (!header) return;
    setExporting(true);
    try {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
      const pageWidth = 612;
      const pageHeight = 792;
      const margin = 48;
      let page = doc.addPage([pageWidth, pageHeight]);
      let y = pageHeight - margin;

      const drawHeaderLine = (label: string, value: string) => {
        page.drawText(label, { x: margin, y, size: 10, font: boldFont, color: rgb(0.2, 0.2, 0.2) });
        page.drawText(value, { x: margin + 110, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
        y -= 18;
      };
      page.drawText('Attendance Export', { x: margin, y, size: 16, font: boldFont });
      y -= 26;
      drawHeaderLine('Club:', header.club_name);
      drawHeaderLine('Event:', header.title);
      drawHeaderLine('Date:', formatDate(header.event_date));
      drawHeaderLine('Time:', `${formatTime(header.start_time)} – ${formatTime(header.end_time)}`);
      y -= 12;

      const col1X = margin;
      const col2X = margin + 260;
      const rowHeight = 20;

      const drawTableHeader = () => {
        page.drawRectangle({ x: margin, y: y - 4, width: pageWidth - margin * 2, height: rowHeight, color: rgb(0.94, 0.94, 0.94) });
        page.drawText('Student ID', { x: col1X + 6, y, size: 10, font: boldFont });
        page.drawText('School email', { x: col2X + 6, y, size: 10, font: boldFont });
        y -= rowHeight;
      };
      drawTableHeader();

      for (const row of rows) {
        if (y < margin + rowHeight) {
          page = doc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
          drawTableHeader();
        }
        page.drawLine({
          start: { x: margin, y: y + rowHeight - 4 },
          end: { x: pageWidth - margin, y: y + rowHeight - 4 },
          thickness: 0.5,
          color: rgb(0.85, 0.85, 0.85),
        });
        page.drawText(row.student_id, { x: col1X + 6, y, size: 10, font });
        page.drawText(row.school_email, { x: col2X + 6, y, size: 10, font });
        y -= rowHeight;
      }

      const base64 = await doc.saveAsBase64();
      const fileUri = `${FileSystem.documentDirectory}${slugify(header.title)}-attendance.pdf`;
      await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, { mimeType: 'application/pdf', dialogTitle: 'Share attendance PDF' });
      } else {
        show('Sharing is not available on this device.', 'error');
      }
    } catch {
      show('Could not generate the PDF. Try again.', 'error');
    } finally {
      setExporting(false);
    }
  }

  async function exportCsv() {
    if (!header) return;
    setExporting(true);
    try {
      const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const lines = ['Student ID,School email', ...rows.map((r) => `${escape(r.student_id)},${escape(r.school_email)}`)];
      const csv = lines.join('\n');
      const fileUri = `${FileSystem.documentDirectory}${slugify(header.title)}-attendance.csv`;
      await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Share attendance CSV' });
      } else {
        show('Sharing is not available on this device.', 'error');
      }
    } catch {
      show('Could not generate the CSV. Try again.', 'error');
    } finally {
      setExporting(false);
    }
  }

  function handleExport() {
    Alert.alert('Export attendance', undefined, [
      { text: 'PDF', onPress: () => void exportPdf() },
      { text: 'CSV', onPress: () => void exportCsv() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  if (!isOfficer) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: CREAM, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 15, color: MUTED, fontFamily: 'Inter_400Regular', textAlign: 'center' }}>
          Only club officers and advisors can view this.
        </Text>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={{ marginTop: 16 }}>
          <Text style={{ color: TEAL, fontFamily: 'Inter_600SemiBold', fontSize: 15 }}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: CREAM }} edges={['top']}>
      {ToastComponent}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 }}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}>
          <Ionicons name="chevron-back" size={26} color={INK} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleExport}
          disabled={phase !== 'ready' || exporting}
          activeOpacity={0.7}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: phase === 'ready' && !exporting ? 1 : 0.4 }}
        >
          {exporting ? <ActivityIndicator size="small" color={TEAL} /> : <Ionicons name="download-outline" size={20} color={TEAL} />}
          <Text style={{ color: TEAL, fontSize: 15, fontWeight: '600', fontFamily: 'Inter_600SemiBold' }}>Export</Text>
        </TouchableOpacity>
      </View>

      {phase === 'loading' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={TEAL} />
        </View>
      ) : phase === 'error' || !header ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: MUTED, fontFamily: 'Inter_400Regular', textAlign: 'center' }}>
            Couldn't load attendance. Try again.
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(_, i) => String(i)}
          ListHeaderComponent={
            <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
              <Text style={{ fontSize: 20, fontWeight: '700', color: INK, fontFamily: 'Zain_700Bold' }}>{header.title}</Text>
              <Text style={{ fontSize: 13, color: MUTED, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                {header.club_name} · {rows.length} checked in
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={{ paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)' }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: INK, fontFamily: 'Inter_600SemiBold' }}>{item.student_id}</Text>
              <Text style={{ fontSize: 13, color: MUTED, fontFamily: 'Inter_400Regular', marginTop: 1 }}>{item.school_email}</Text>
            </View>
          )}
          ListEmptyComponent={
            <View style={{ padding: 24, alignItems: 'center' }}>
              <Text style={{ color: MUTED, fontFamily: 'Inter_400Regular' }}>No check-ins yet.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
