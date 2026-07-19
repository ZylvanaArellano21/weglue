import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const ME='348fe28b-061a-423e-8736-47502a2ef0fd';
const { data: me } = await sb.from('profiles').select('id,username,full_name,university_id').eq('id',ME).single();
const { data: club } = await sb.from('clubs').insert({
  name:'QA Phase4 Club', handle:'qa-p4-'+Date.now().toString().slice(-6),
  description:'Temp QA club for event edit, post edit, media overlay, realtime.',
  avatar_url:'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=400',
  banner_url:'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1200',
  meeting_day:'Wednesday', meeting_time_start:'13:00:00', meeting_time_end:'14:00:00',
  meeting_building:'F', meeting_room:'219', university_id:me.university_id, is_active:true }).select().single();
await sb.from('club_members').insert({club_id:club.id,user_id:ME,role:'officer'});
await sb.from('club_officers').insert({club_id:club.id,user_id:ME,display_name:me.full_name||me.username,role_title:'President'});
await sb.from('club_goals').insert([{club_id:club.id,goal_text:'Original outcome',display_order:0}]);
const future=new Date(Date.now()+6*86400000).toISOString().slice(0,10);
const { data: ev } = await sb.from('events').insert({club_id:club.id,created_by:ME,title:'Editable Event',emoji:'✏️',description:'Original description.',cover_image_url:'https://images.unsplash.com/photo-1509557965875-b88c97052f0e?w=1000',event_date:future,start_time:'13:00:00',end_time:'15:00:00',building:'F',room:'313',visibility:'everyone'}).select().single();
await sb.from('club_photos').insert({club_id:club.id,url:'https://images.unsplash.com/photo-1517486808906-6ca8b3f04846?w=800',uploaded_by:ME,source:'officer_upload',caption:'Officer upload photo',is_visible:true});
// a tagged post by ANOTHER user so Follow shows + author-edit is hidden for the officer viewer
const { data: others } = await sb.from('profiles').select('id,username').neq('id',ME).limit(1);
const other = others[0];
const { data: post } = await sb.from('posts').insert({author_id:other.id,club_id:club.id,post_type:'picture',image_url:'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800',caption:'A post by another member for media overlay QA'}).select().single();
// a tagged post by ME (author) so caption-edit is available
const { data: mypost } = await sb.from('posts').insert({author_id:ME,club_id:club.id,post_type:'picture',image_url:'https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=800',caption:'My own post caption'}).select().single();
await new Promise(r=>setTimeout(r,500));
const { data: photos } = await sb.from('club_photos').select('id,source,post_id').eq('club_id',club.id).order('created_at',{ascending:false});
console.log('CLUB_ID='+club.id);
console.log('EVENT_ID='+ev.id);
console.log('other poster:', other.username, other.id);
console.log('photos:', JSON.stringify(photos));
