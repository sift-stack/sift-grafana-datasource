import React, { SVGProps } from 'react';

export function RegexIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 16 16" {...props}>
      <path
        fill="currentColor"
        d="M11 1.5a.5.5 0 0 0-1 0v3.13L7.29 3.06a.5.5 0 0 0-.5.866l2.71 1.57l-2.71 1.57a.5.5 0 0 0 .5.866L10 6.362v3.13a.5.5 0 0 0 1 0v-3.13l2.71 1.57a.5.5 0 0 0 .5-.866l-2.71-1.57l2.71-1.57a.5.5 0 0 0-.5-.866L11 4.63zM3.08 11.6c-.076.184-.076.417-.076.883s0 .699.076.883c.101.245.296.44.541.541c.184.076.417.076.883.076s.699 0 .883-.076a1 1 0 0 0 .541-.541c.076-.184.076-.417.076-.883s0-.699-.076-.883a1 1 0 0 0-.541-.541c-.184-.076-.417-.076-.883-.076s-.699 0-.883.076a1 1 0 0 0-.541.541"
      ></path>
    </svg>
  );
}

export function SelectIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 24 24" {...props}>
      <path
        fill="currentColor"
        d="m6 9.657l1.414 1.414l4.243-4.243l4.243 4.243l1.414-1.414L11.657 4zm0 4.786l1.414-1.414l4.243 4.243l4.243-4.243l1.414 1.414l-5.657 5.657z"
      ></path>
    </svg>
  );
}
