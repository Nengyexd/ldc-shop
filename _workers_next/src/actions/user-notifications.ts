"use server"

import { auth } from "@/lib/auth"
import { clearUserNotifications, getUserNotifications, getUserUnreadNotificationCount, markAllUserNotificationsRead, markUserNotificationRead } from "@/lib/db/queries"
import { broadcastMessages, broadcastReads } from "@/lib/db/schema"
import { db } from "@/lib/db"
import { and, desc, eq, sql } from "drizzle-orm"

const BROADCAST_LIMIT = 10

export async function markAllNotificationsRead() {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) {
        return { success: false, error: "Unauthorized" }
    }

    await markAllUserNotificationsRead(userId)
    try {
        const now = new Date()
        await db.run(sql`
            INSERT INTO broadcast_reads (message_id, user_id, created_at)
            SELECT m.id, ${userId}, ${now}
            FROM broadcast_messages m
            WHERE NOT EXISTS (
                SELECT 1 FROM broadcast_reads r
                WHERE r.message_id = m.id AND r.user_id = ${userId}
            )
        `)
    } catch {
        // ignore
    }
    return { success: true }
}

export async function getMyNotifications() {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) {
        return { success: false, error: "Unauthorized" }
    }

    const rows = await getUserNotifications(userId, 20)
    const directItems = rows.map((n) => ({
        id: n.id,
        type: n.type,
        titleKey: n.titleKey,
        contentKey: n.contentKey,
        data: n.data,
        isRead: n.isRead,
        createdAt: n.createdAt ? new Date(n.createdAt as any).getTime() : null
    }))

    let broadcastItems: any[] = []
    try {
        const broadcasts = await db
            .select({
                id: broadcastMessages.id,
                title: broadcastMessages.title,
                body: broadcastMessages.body,
                sender: broadcastMessages.sender,
                createdAt: broadcastMessages.createdAt,
            })
            .from(broadcastMessages)
            .orderBy(desc(broadcastMessages.createdAt))
            .limit(BROADCAST_LIMIT)

        if (broadcasts.length > 0) {
            const ids = broadcasts.map((b) => b.id)
            const readRows = await db
                .select({ id: broadcastReads.messageId })
                .from(broadcastReads)
                .where(and(eq(broadcastReads.userId, userId), sql`${broadcastReads.messageId} IN (${sql.join(ids)})`))
            const readSet = new Set(readRows.map((r) => r.id))
            broadcastItems = broadcasts.map((b) => ({
                id: b.id,
                type: "broadcast",
                titleKey: "profile.notifications.adminMessageTitle",
                contentKey: "profile.notifications.adminMessageBody",
                data: JSON.stringify({ title: b.title, body: b.body }),
                isRead: readSet.has(b.id),
                createdAt: b.createdAt ? new Date(b.createdAt as any).getTime() : null
            }))
        }
    } catch {
        broadcastItems = []
    }

    const items = [...broadcastItems, ...directItems].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return { success: true, items }
}

export async function getMyUnreadCount() {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) {
        return { success: false, error: "Unauthorized" }
    }

    const directCount = await getUserUnreadNotificationCount(userId)
    let broadcastUnread = 0
    try {
        const broadcastRows = await db
            .select({ id: broadcastMessages.id })
            .from(broadcastMessages)
            .orderBy(desc(broadcastMessages.createdAt))
            .limit(BROADCAST_LIMIT)
        const ids = broadcastRows.map((b) => b.id)
        if (ids.length === 0) {
            broadcastUnread = 0
        } else {
            const readRow = await db.select({ count: sql<number>`count(DISTINCT ${broadcastReads.messageId})` })
                .from(broadcastReads)
                .where(and(eq(broadcastReads.userId, userId), sql`${broadcastReads.messageId} IN (${sql.join(ids)})`))
            const read = Number(readRow[0]?.count || 0)
            broadcastUnread = Math.max(0, ids.length - read)
        }
    } catch {
        broadcastUnread = 0
    }
    return { success: true, count: directCount + broadcastUnread }
}

export async function markNotificationRead(id: number) {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) {
        return { success: false, error: "Unauthorized" }
    }

    await markUserNotificationRead(userId, id)
    try {
        const now = new Date()
        await db.run(sql`
            INSERT INTO broadcast_reads (message_id, user_id, created_at)
            SELECT ${id}, ${userId}, ${now}
            WHERE EXISTS (SELECT 1 FROM broadcast_messages WHERE id = ${id})
              AND NOT EXISTS (
                  SELECT 1 FROM broadcast_reads
                  WHERE message_id = ${id} AND user_id = ${userId}
              )
        `)
    } catch {
        // ignore
    }
    return { success: true }
}

export async function clearMyNotifications() {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) {
        return { success: false, error: "Unauthorized" }
    }

    await clearUserNotifications(userId)
    try {
        const now = new Date()
        await db.run(sql`
            INSERT INTO broadcast_reads (message_id, user_id, created_at)
            SELECT m.id, ${userId}, ${now}
            FROM broadcast_messages m
            WHERE NOT EXISTS (
                SELECT 1 FROM broadcast_reads r
                WHERE r.message_id = m.id AND r.user_id = ${userId}
            )
        `)
    } catch {
        // ignore
    }
    return { success: true }
}
