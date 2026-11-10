"use client";
import React, { useEffect, useRef } from "react";
import * as core from "@/lib/core/kitchen.mjs";
const C: any = core;
export function Heading({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">Scotty’s on King · Vision</div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      {children}
    </div>
  );
}
export function Field({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = props.id || props.name;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input {...props} id={id} />
    </div>
  );
}
export function UnitSelect({
  value,
  onChange,
  label = "Measure",
}: {
  value: string;
  onChange: (s: string) => void;
  label?: string;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(C.UNITS).map(([k, v]: any) => (
          <option key={k} value={k}>
            {v.label}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-head">
        <div className="eyebrow">Vision Kitchen</div>
        <button className="quiet" onClick={onClose}>
          ✕ Close
        </button>
      </div>
      {children}
    </dialog>
  );
}
