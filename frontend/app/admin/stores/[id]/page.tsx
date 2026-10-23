"use client";

import { useParams } from "next/navigation";
import AdminPanel from "@/components/panel/AdminPanel";
import StoreForm from "@/components/panel/StoreForm";

export default function EditStorePage() {
  const { id } = useParams<{ id: string }>();
  return <AdminPanel><StoreForm key={id} shopId={id} /></AdminPanel>;
}
