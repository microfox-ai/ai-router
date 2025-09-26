'use server'

import { JSDOM } from 'jsdom';

export async function jsDom(html: string) {
    return new JSDOM(html);
}
