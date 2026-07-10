import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@weglue/shared';
import {
  getMyChats,
  getChatDetails,
  getDirectMessages,
  sendDirectMessage,
  searchChats,
  getSuggestedPeople,
  getNonMemberPreview,
  isConversationMember,
  markConversationRead,
} from '../services/chatService';
import { timedQuery } from '../lib/timedQuery';

export function useMyChats(userId: string | undefined) {
  return useQuery({
    queryKey: ['myChats', userId],
    queryFn: () => timedQuery('myChats', getMyChats(userId!)),
    enabled: !!userId,
    staleTime: 15 * 1000,
  });
}

export function useChatDetails(conversationId: string | undefined) {
  // Identity resolution (DM titles/avatars) is viewer-relative, so the
  // current user id is part of the query.
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['chatDetails', conversationId, userId],
    queryFn: () => timedQuery('chatDetails', getChatDetails(conversationId!, userId!)),
    enabled: !!conversationId && !!userId,
    staleTime: 60 * 1000,
  });
}

export function useConversationMembership(
  conversationId: string | undefined,
  userId: string | undefined,
) {
  return useQuery({
    queryKey: ['conversationMember', conversationId, userId],
    queryFn: () => isConversationMember(conversationId!, userId!),
    enabled: !!conversationId && !!userId,
    staleTime: 30 * 1000,
  });
}

export function useDirectMessages(conversationId: string | undefined, cursor?: string) {
  return useQuery({
    queryKey: ['directMessages', conversationId, cursor],
    queryFn: () => timedQuery('directMessages', getDirectMessages(conversationId!, cursor)),
    enabled: !!conversationId,
    staleTime: 0,
  });
}

export function useSendDirectMessage(conversationId: string, senderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      content,
      attachmentUrl,
      attachmentType,
    }: {
      content: string;
      attachmentUrl?: string;
      attachmentType?: 'image' | 'file';
    }) => sendDirectMessage(conversationId, senderId, content, attachmentUrl, attachmentType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['directMessages', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['myChats'] });
    },
  });
}

export function useNonMemberPreview(conversationId: string | undefined) {
  return useQuery({
    queryKey: ['nonMemberPreview', conversationId],
    queryFn: () => getNonMemberPreview(conversationId!),
    enabled: !!conversationId,
    staleTime: 60 * 1000,
  });
}

export function useChatSearch(userId: string | undefined, query: string) {
  return useQuery({
    queryKey: ['chatSearch', userId, query],
    queryFn: () => searchChats(userId!, query),
    enabled: !!userId && query.trim().length > 0,
    staleTime: 30 * 1000,
  });
}

export function useSuggestedPeople(userId: string | undefined) {
  return useQuery({
    queryKey: ['suggestedPeople', userId],
    queryFn: () => getSuggestedPeople(userId!),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useMarkConversationRead(conversationId: string | undefined) {
  return useMutation({
    mutationFn: () => markConversationRead(conversationId!),
    onSuccess: () => {},
  });
}
