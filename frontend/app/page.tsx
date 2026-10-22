"use client";

import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import Composer from "@/components/Composer";
import { newId, setPending } from "@/lib/store";
import type { ProductCard } from "@/lib/types";

// Examples drawn from what the Torob dataset actually holds (Tehran shops; phones, CCTV, cables, lighting).
const EXAMPLES = ["ارزون‌ترین گوشی سامسونگ A26", "دوربین مدار بسته داهوا", "یه گوشی خوب می‌خوام"];

export default function Home() {
  const router = useRouter();

  function start(text: string, attachments: ProductCard[] = []) {
    const id = newId();
    setPending(id, { text, attachments });
    router.push(`/c/${id}`);
  }

  return (
    <AppShell>
      <main className="home">
        <div className="home-hero">
          <img className="pixel" src="/brand/radish.gif" width={64} height={64} alt="" />
          <h1 className="home-title">چی می‌خوای بخری؟</h1>
        </div>
        <div className="home-inner">
          <Composer variant="home" onSend={start} placeholder="اسم محصول یا بودجه‌ت رو بنویس" />
          <div className="chips home-chips" style={{ justifyContent: "center" }}>
            {EXAMPLES.map((e) => (
              <button key={e} className="chip" onClick={() => start(e)}>{e}</button>
            ))}
          </div>
        </div>
        <p className="home-foot">قیمت‌ها از فروشگاه‌های تهران در ترب خوانده می‌شه.</p>
      </main>
    </AppShell>
  );
}
