"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

function AlertDialog(props: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({ className, ...props }: AlertDialogPrimitive.Trigger.Props) {
  return (
    <AlertDialogPrimitive.Trigger
      data-slot="alert-dialog-trigger"
      className={cn(
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogPortal(props: AlertDialogPrimitive.Portal.Props) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
}

function AlertDialogBackdrop({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-backdrop"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[starting-style]:transition-opacity data-[ending-style]:transition-opacity",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogPopup({ className, ...props }: AlertDialogPrimitive.Popup.Props) {
  return (
    <AlertDialogPrimitive.Popup
      data-slot="alert-dialog-popup"
      className={cn(
        "fixed top-1/2 left-1/2 z-50 w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-xl sm:max-w-md",
        // Enter/exit from scale(0.95)+opacity 0 — never scale(0) (emil-design-eng).
        // Modals keep transform-origin center (they're not anchored to a trigger).
        "data-[starting-style]:translate-x-[-50%] data-[starting-style]:translate-y-[-50%] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[starting-style]:transition-[transform,opacity,scale,translate]",
        "data-[ending-style]:translate-x-[-50%] data-[ending-style]:translate-y-[-50%] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:transition-[transform,opacity,scale,translate]",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-lg font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function AlertDialogClose({ className, ...props }: AlertDialogPrimitive.Close.Props) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-close"
      className={cn(
        "absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

/** Standard Cancel button for the AlertDialog footer. */
function AlertDialogCancel({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="alert-dialog-cancel"
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9 text-xs", className)}
      {...props}
    />
  )
}

/** Standard destructive Confirm button for the AlertDialog footer. */
function AlertDialogAction({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="alert-dialog-action"
      className={cn(buttonVariants({ variant: "destructive", size: "sm" }), "h-9 text-xs", className)}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogTrigger,
  AlertDialogPortal,
  AlertDialogBackdrop,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
}
