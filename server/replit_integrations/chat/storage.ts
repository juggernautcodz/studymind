import prisma from "../../db";

export interface IChatStorage {
  getConversation(id: number): Promise<any>;
  getAllConversations(): Promise<any[]>;
  createConversation(title: string): Promise<any>;
  deleteConversation(id: number): Promise<void>;
  getMessagesByConversation(conversationId: number): Promise<any[]>;
  createMessage(
    conversationId: number,
    role: string,
    content: string,
  ): Promise<any>;
}

const conversations: Map<
  number,
  { id: number; title: string; createdAt: Date }
> = new Map();
const messages: Map<
  number,
  {
    id: number;
    conversationId: number;
    role: string;
    content: string;
    createdAt: Date;
  }[]
> = new Map();
let nextConversationId = 1;
let nextMessageId = 1;

export const chatStorage: IChatStorage = {
  async getConversation(id: number) {
    return conversations.get(id);
  },

  async getAllConversations() {
    return Array.from(conversations.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  },

  async createConversation(title: string) {
    const conversation = {
      id: nextConversationId++,
      title,
      createdAt: new Date(),
    };
    conversations.set(conversation.id, conversation);
    messages.set(conversation.id, []);
    return conversation;
  },

  async deleteConversation(id: number) {
    conversations.delete(id);
    messages.delete(id);
  },

  async getMessagesByConversation(conversationId: number) {
    return messages.get(conversationId) || [];
  },

  async createMessage(conversationId: number, role: string, content: string) {
    const message = {
      id: nextMessageId++,
      conversationId,
      role,
      content,
      createdAt: new Date(),
    };
    const conversationMessages = messages.get(conversationId) || [];
    conversationMessages.push(message);
    messages.set(conversationId, conversationMessages);
    return message;
  },
};
