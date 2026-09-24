// next-env.d.ts is git-ignored and only exists after a Next run, so CI typecheck would not know the
// image module types (import logo from "@/assets/logo.svg"). Reference them here so it always does.
/// <reference types="next/image-types/global" />
