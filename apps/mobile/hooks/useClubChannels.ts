import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getClubChannels,
  getChannelMessages,
  sendMessage,
  deleteMessage,
  createChannel,
  deleteChannel,
  renameChannel,
  getClubConversationId,
  getConversationHub,
  type Attachment,
} from '../services/channelService';
import { timedQuery } from '../lib/timedQuery';

export function useClubChannels(clubId: string | undefined) {
  return useQuery({
    queryKey: ['clubChannels', clubId],
    queryFn: () => timedQuery('clubChannels', getClubChannels(clubId!)),
    enabled: !!clubId,
    staleTime: 30 * 1000,
  });
}

/** Conversation hub: Main chat + hashtag threads with previews + unread. */
export function useConversationHub(
  conversationId: string | undefined,
  userId: string | undefined,
) {
  return useQuery({
    queryKey: ['conversationHub', conversationId, userId],
    queryFn: () => getConversationHub(conversationId!, userId!),
    enabled: !!conversationId && !!userId,
    staleTime: 10 * 1000,
  });
}

export function useClubConversationId(clubId: string | undefined) {
  return useQuery({
    queryKey: ['clubConversationId', clubId],
    queryFn: () => getClubConversationId(clubId!),
    enabled: !!clubId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useChannelMessages(channelId: string | undefined, cursor?: string) {
  return useQuery({
    queryKey: ['channelMessages', channelId, cursor],
    queryFn: () => timedQuery('channelMessages', getChannelMessages(channelId!, cursor)),
    enabled: !!channelId,
    staleTime: 0,
  });
}

export function useSendMessage(
  conversationId: string,
  channelId: string,
  senderId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      content,
      attachment,
    }: {
      content: string;
      attachment?: Attachment;
    }) => sendMessage(conversationId, channelId, senderId, content, attachment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channelMessages', channelId] });
    },
  });
}

export function useDeleteMessage(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => deleteMessage(messageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channelMessages', channelId] });
    },
  });
}

export function useCreateChannel(clubId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, name }: { conversationId: string; name: string }) =>
      createChannel(conversationId, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clubChannels', clubId] });
    },
  });
}

export function useDeleteChannel(clubId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) => deleteChannel(channelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clubChannels', clubId] });
    },
  });
}

export function useRenameChannel(clubId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, name }: { channelId: string; name: string }) =>
      renameChannel(channelId, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clubChannels', clubId] });
    },
  });
}
