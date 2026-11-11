import { NextRequest, NextResponse } from 'next/server';
import { bandwidthService } from '@/lib/services/bandwidthService';

/**
 * Scheduled Cron Handler for Automatic Video Lifecycle Cleanup.
 * 
 * Rules:
 * - Deletes video objects 24 hours after room closure.
 * - Deletes video objects 7 days after room abandonment.
 * - Idempotent and safe to retry.
 * 
 * Secure invocation via header:
 * Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = (process.env.CRON_SECRET || '').trim();

  if (!cronSecret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'CRON_SECRET is not configured on the server.' },
        { status: 500 }
      );
    }
  } else if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await bandwidthService.runVideoCleanup();
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      deletedCount: result.deletedCount,
      freedBytes: result.freedBytes,
      freedMb: (result.freedBytes / (1024 * 1024)).toFixed(2),
      errors: result.errors,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cleanup failed' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}

