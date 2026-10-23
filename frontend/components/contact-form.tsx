"use client";

import { useState, type FormEvent } from "react";
import { ArrowUpRight, Mail } from "lucide-react";
import { supportEmail } from "@/lib/site-content";

export function ContactForm({ selectedPlan }: { selectedPlan?: "starter" | "pro" }) {
  const [prepared, setPrepared] = useState(false);
  const plan = selectedPlan === "starter" ? "Starter" : selectedPlan === "pro" ? "Pro" : null;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const subject = `InterviewWin · ${data.get("topic")}`;
    const body = `Name: ${String(data.get("name")).trim()}\nReply to: ${String(data.get("email")).trim()}\n\n${String(data.get("message")).trim()}`;
    window.location.href = `mailto:${supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setPrepared(true);
  }
  return <form className="contact-form form-stack" action={`mailto:${supportEmail}`} method="post" encType="text/plain" onSubmit={submit}>
    <div className="form-grid"><label>Your name<input name="name" autoComplete="name" required maxLength={120} placeholder="Alex Morgan" /></label><label>Email address<input name="email" type="email" autoComplete="email" required maxLength={320} placeholder="you@example.com" /></label></div>
    <label>What can we help with?<select name="topic" defaultValue={plan ? "Account or billing" : "Product support"}><option>Product support</option><option>Account or billing</option><option>Privacy or data request</option><option>Feedback or an idea</option></select></label>
    <div className="contact-message-field"><label htmlFor="support-message">Your message</label><textarea id="support-message" key={plan} name="message" defaultValue={plan ? `I’m interested in the ${plan} plan. Please let me know when it is available.` : ""} required minLength={10} maxLength={4000} rows={6} placeholder="Tell us what you’re trying to do and what happened…" /></div>
    <p className="contact-form-note">Please leave out passwords, API keys, resumes, and private conversation content.</p>
    <button className="button button-primary" type="submit"><Mail size={17} aria-hidden="true" /> Prepare support email <ArrowUpRight size={16} aria-hidden="true" /></button>
    <p className="contact-form-note">Opens your email app. Review and send the message there.</p>
    {prepared && <p className="contact-form-status" role="status">Your email app was requested; this website has not sent a message. If nothing opened, email <a href={`mailto:${supportEmail}`}>{supportEmail}</a> directly and include the details above.</p>}
  </form>;
}
