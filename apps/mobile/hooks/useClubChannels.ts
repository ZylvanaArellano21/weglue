import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getClubChannels,
  getChannelMessages,
  sendMessage,
  deleteMessage,
  createChannel,
  deleteChannel,
  getClubConversationId,
  type CreateChannelInput,
  type Attachment,
} from '../services/channelService';

export function useClubChannels(clubId: string | undefined) {
  return useQuery({
    queryKey: ['clubChannels', clubId],
    queryFn: () => getClubChannels(clubId!),
    enabled: !!clubId,
    staleTime: 30 * 1000,
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
    queryFn: () => getChannelMessages(channelId!, cursor),
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

export function useCreateChannel(clubId: string, createdBy: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateChannelInput) => createChannel(clubId, createdBy, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clubChannels', clubId] });
    },
  });
}

export function useDeleteChannel(clubId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) => deleteChannel(channelId, clubId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clubChannels', clubId] });
    },
  });
}
