"use client";

import { createContext, useContext } from "react";
import type { ProductCard } from "@/lib/types";

type Chat = { send: (text: string, attachments?: ProductCard[]) => void; busy: boolean };

export const ChatContext = createContext<Chat>({ send: () => {}, busy: false });
export const useChat = () => useContext(ChatContext);
