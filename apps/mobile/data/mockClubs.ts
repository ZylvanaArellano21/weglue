export interface MockEvent {
  id: string;
  title: string;
  emoji: string;
  date: string;
  time: string;
  location: string;
  description: string;
  going: number;
  headerImageUrl: string;
}

export interface MockOfficer {
  id: string;
  name: string;
  role: string;
  avatarUrl: string;
}

export interface MockMember {
  id: string;
  name: string;
  avatarUrl: string;
  isGluemate: boolean;
}

export interface MockClub {
  id: string;
  name: string;
  memberCount: number;
  gluemates: number;
  avatarUrl: string;
  headerImageUrl: string;
  about: string;
  keyBenefits: [string, string, string];
  meetingSchedule: {
    day: string;
    time: string;
    location: string;
  };
  upcomingEvents: MockEvent[];
  photos: [string, string, string];
  officers: MockOfficer[];
  members: MockMember[];
}

export const MOCK_CLUBS: MockClub[] = [
  {
    id: "accounting-club",
    name: "Accounting Club",
    memberCount: 40,
    gluemates: 12,
    avatarUrl: "https://picsum.photos/seed/acct-avatar/100/100",
    headerImageUrl: "https://picsum.photos/seed/acct-header/600/220",
    about:
      "Join us to explore finance, build skills, and connect with future professionals!",
    keyBenefits: [
      "Learn how to do taxes and manage budgets",
      "Meet professionals and explore careers",
      "Gain real-world accounting skills",
    ],
    meetingSchedule: {
      day: "Wednesday",
      time: "1:00 pm - 2:00 pm",
      location: "Building F, Room 219",
    },
    upcomingEvents: [
      {
        id: "acct-evt-1",
        title: "FALL event!! Pumpkin carving",
        emoji: "🎃",
        date: "10 October 2025",
        time: "1:00 pm - 3:00 pm",
        location: "F 313",
        description:
          "Come join us for our annual fall pumpkin carving event! We'll have snacks, music, and lots of fun. All skill levels welcome.",
        going: 18,
        headerImageUrl: "https://picsum.photos/seed/acct-evt1/600/280",
      },
      {
        id: "acct-evt-2",
        title: "Tax Workshop: Filing 101",
        emoji: "📋",
        date: "22 October 2025",
        time: "3:00 pm - 5:00 pm",
        location: "F 219",
        description:
          "Learn how to file your taxes as a student. A CPA will walk us through everything step by step.",
        going: 27,
        headerImageUrl: "https://picsum.photos/seed/acct-evt2/600/280",
      },
    ],
    photos: [
      "https://picsum.photos/seed/acct-photo1/300/300",
      "https://picsum.photos/seed/acct-photo2/300/300",
      "https://picsum.photos/seed/acct-photo3/300/300",
    ],
    officers: [
      {
        id: "acct-o1",
        name: "Josefina Ruiz",
        role: "President",
        avatarUrl: "https://picsum.photos/seed/acct-o1/80/80",
      },
      {
        id: "acct-o2",
        name: "Iniesta Ruiz",
        role: "Vice President",
        avatarUrl: "https://picsum.photos/seed/acct-o2/80/80",
      },
      {
        id: "acct-o3",
        name: "Marcus Chen",
        role: "Treasurer",
        avatarUrl: "https://picsum.photos/seed/acct-o3/80/80",
      },
    ],
    members: [
      { id: "acct-m1", name: "Josefina Ruiz", avatarUrl: "https://picsum.photos/seed/acct-m1/60/60", isGluemate: true },
      { id: "acct-m2", name: "Iniesta Ruiz", avatarUrl: "https://picsum.photos/seed/acct-m2/60/60", isGluemate: true },
      { id: "acct-m3", name: "Marcus Chen", avatarUrl: "https://picsum.photos/seed/acct-m3/60/60", isGluemate: true },
      { id: "acct-m4", name: "Priya Sharma", avatarUrl: "https://picsum.photos/seed/acct-m4/60/60", isGluemate: true },
      { id: "acct-m5", name: "Elijah Brooks", avatarUrl: "https://picsum.photos/seed/acct-m5/60/60", isGluemate: false },
      { id: "acct-m6", name: "Sofia Morales", avatarUrl: "https://picsum.photos/seed/acct-m6/60/60", isGluemate: false },
      { id: "acct-m7", name: "Daniel Park", avatarUrl: "https://picsum.photos/seed/acct-m7/60/60", isGluemate: false },
      { id: "acct-m8", name: "Aisha Williams", avatarUrl: "https://picsum.photos/seed/acct-m8/60/60", isGluemate: false },
      { id: "acct-m9", name: "Liam Nguyen", avatarUrl: "https://picsum.photos/seed/acct-m9/60/60", isGluemate: false },
      { id: "acct-m10", name: "Isabella Torres", avatarUrl: "https://picsum.photos/seed/acct-m10/60/60", isGluemate: false },
      { id: "acct-m11", name: "Noah Kim", avatarUrl: "https://picsum.photos/seed/acct-m11/60/60", isGluemate: false },
      { id: "acct-m12", name: "Mia Johnson", avatarUrl: "https://picsum.photos/seed/acct-m12/60/60", isGluemate: false },
    ],
  },
  {
    id: "dance-club",
    name: "Dance Club",
    memberCount: 55,
    gluemates: 8,
    avatarUrl: "https://picsum.photos/seed/dance-avatar/100/100",
    headerImageUrl: "https://picsum.photos/seed/dance-header/600/220",
    about:
      "Express yourself through movement! We welcome all styles — hip-hop, contemporary, salsa, and more.",
    keyBenefits: [
      "Learn choreography from experienced dancers",
      "Perform at campus-wide showcases",
      "Build confidence and coordination",
    ],
    meetingSchedule: {
      day: "Tuesday & Thursday",
      time: "5:00 pm - 7:00 pm",
      location: "Dance Studio B",
    },
    upcomingEvents: [
      {
        id: "dance-evt-1",
        title: "Fall Showcase Auditions",
        emoji: "🎤",
        date: "5 November 2025",
        time: "4:00 pm - 6:00 pm",
        location: "Dance Studio B",
        description:
          "Audition for our annual fall showcase! Solo and group slots available. No experience necessary — we value passion.",
        going: 30,
        headerImageUrl: "https://picsum.photos/seed/dance-evt1/600/280",
      },
      {
        id: "dance-evt-2",
        title: "Salsa Night Mixer",
        emoji: "💃",
        date: "18 October 2025",
        time: "7:00 pm - 10:00 pm",
        location: "Student Union Ballroom",
        description:
          "Free salsa lessons for beginners followed by a social dance floor. Bring a partner or come solo!",
        going: 45,
        headerImageUrl: "https://picsum.photos/seed/dance-evt2/600/280",
      },
    ],
    photos: [
      "https://picsum.photos/seed/dance-photo1/300/300",
      "https://picsum.photos/seed/dance-photo2/300/300",
      "https://picsum.photos/seed/dance-photo3/300/300",
    ],
    officers: [
      {
        id: "dance-o1",
        name: "Camila Reyes",
        role: "President",
        avatarUrl: "https://picsum.photos/seed/dance-o1/80/80",
      },
      {
        id: "dance-o2",
        name: "Jordan Ellis",
        role: "Choreography Director",
        avatarUrl: "https://picsum.photos/seed/dance-o2/80/80",
      },
    ],
    members: [
      { id: "dance-m1", name: "Camila Reyes", avatarUrl: "https://picsum.photos/seed/dance-m1/60/60", isGluemate: true },
      { id: "dance-m2", name: "Jordan Ellis", avatarUrl: "https://picsum.photos/seed/dance-m2/60/60", isGluemate: true },
      { id: "dance-m3", name: "Ava Thompson", avatarUrl: "https://picsum.photos/seed/dance-m3/60/60", isGluemate: true },
      { id: "dance-m4", name: "Jaylen Washington", avatarUrl: "https://picsum.photos/seed/dance-m4/60/60", isGluemate: false },
      { id: "dance-m5", name: "Mei Lin", avatarUrl: "https://picsum.photos/seed/dance-m5/60/60", isGluemate: false },
      { id: "dance-m6", name: "Tomas Garcia", avatarUrl: "https://picsum.photos/seed/dance-m6/60/60", isGluemate: false },
      { id: "dance-m7", name: "Chloe Martin", avatarUrl: "https://picsum.photos/seed/dance-m7/60/60", isGluemate: false },
      { id: "dance-m8", name: "Andre Davis", avatarUrl: "https://picsum.photos/seed/dance-m8/60/60", isGluemate: false },
      { id: "dance-m9", name: "Natalia Cruz", avatarUrl: "https://picsum.photos/seed/dance-m9/60/60", isGluemate: false },
      { id: "dance-m10", name: "Ethan Lee", avatarUrl: "https://picsum.photos/seed/dance-m10/60/60", isGluemate: false },
      { id: "dance-m11", name: "Zoe Adams", avatarUrl: "https://picsum.photos/seed/dance-m11/60/60", isGluemate: false },
    ],
  },
  {
    id: "pre-law",
    name: "Pre-Law Society",
    memberCount: 34,
    gluemates: 6,
    avatarUrl: "https://picsum.photos/seed/prelaw-avatar/100/100",
    headerImageUrl: "https://picsum.photos/seed/prelaw-header/600/220",
    about:
      "Preparing the next generation of lawyers and advocates through mentorship, debate, and real-world exposure.",
    keyBenefits: [
      "Get guidance on law school applications and the LSAT",
      "Network with practicing attorneys and alumni",
      "Sharpen analytical and public speaking skills",
    ],
    meetingSchedule: {
      day: "Monday",
      time: "6:00 pm - 7:30 pm",
      location: "Social Sciences Building, Room 302",
    },
    upcomingEvents: [
      {
        id: "prelaw-evt-1",
        title: "Mock Trial Competition",
        emoji: "⚖️",
        date: "1 November 2025",
        time: "10:00 am - 4:00 pm",
        location: "SS 401 Moot Court",
        description:
          "Compete in our annual mock trial. Teams of four argue both sides of a civil case. Prizes for top teams.",
        going: 22,
        headerImageUrl: "https://picsum.photos/seed/prelaw-evt1/600/280",
      },
      {
        id: "prelaw-evt-2",
        title: "LSAT Prep Session",
        emoji: "📚",
        date: "14 October 2025",
        time: "2:00 pm - 4:00 pm",
        location: "SS 302",
        description:
          "Alumni who scored 170+ share strategies for logical reasoning and reading comprehension sections.",
        going: 31,
        headerImageUrl: "https://picsum.photos/seed/prelaw-evt2/600/280",
      },
    ],
    photos: [
      "https://picsum.photos/seed/prelaw-photo1/300/300",
      "https://picsum.photos/seed/prelaw-photo2/300/300",
      "https://picsum.photos/seed/prelaw-photo3/300/300",
    ],
    officers: [
      {
        id: "prelaw-o1",
        name: "Amara Osei",
        role: "President",
        avatarUrl: "https://picsum.photos/seed/prelaw-o1/80/80",
      },
      {
        id: "prelaw-o2",
        name: "Ricardo Santos",
        role: "Vice President",
        avatarUrl: "https://picsum.photos/seed/prelaw-o2/80/80",
      },
      {
        id: "prelaw-o3",
        name: "Hannah Patel",
        role: "Secretary",
        avatarUrl: "https://picsum.photos/seed/prelaw-o3/80/80",
      },
    ],
    members: [
      { id: "prelaw-m1", name: "Amara Osei", avatarUrl: "https://picsum.photos/seed/prelaw-m1/60/60", isGluemate: true },
      { id: "prelaw-m2", name: "Ricardo Santos", avatarUrl: "https://picsum.photos/seed/prelaw-m2/60/60", isGluemate: true },
      { id: "prelaw-m3", name: "Hannah Patel", avatarUrl: "https://picsum.photos/seed/prelaw-m3/60/60", isGluemate: false },
      { id: "prelaw-m4", name: "Jason Murphy", avatarUrl: "https://picsum.photos/seed/prelaw-m4/60/60", isGluemate: false },
      { id: "prelaw-m5", name: "Diane Chukwu", avatarUrl: "https://picsum.photos/seed/prelaw-m5/60/60", isGluemate: false },
      { id: "prelaw-m6", name: "Victor Huang", avatarUrl: "https://picsum.photos/seed/prelaw-m6/60/60", isGluemate: false },
      { id: "prelaw-m7", name: "Fatima Al-Hassan", avatarUrl: "https://picsum.photos/seed/prelaw-m7/60/60", isGluemate: false },
      { id: "prelaw-m8", name: "Lucas Rivera", avatarUrl: "https://picsum.photos/seed/prelaw-m8/60/60", isGluemate: false },
      { id: "prelaw-m9", name: "Grace Okafor", avatarUrl: "https://picsum.photos/seed/prelaw-m9/60/60", isGluemate: false },
      { id: "prelaw-m10", name: "Samuel Kofi", avatarUrl: "https://picsum.photos/seed/prelaw-m10/60/60", isGluemate: false },
    ],
  },
  {
    id: "photography-club",
    name: "Photography Club",
    memberCount: 28,
    gluemates: 5,
    avatarUrl: "https://picsum.photos/seed/photo-avatar/100/100",
    headerImageUrl: "https://picsum.photos/seed/photo-header/600/220",
    about:
      "From golden hour portraits to street photography — capture the world around you and grow your eye for detail.",
    keyBenefits: [
      "Access to professional camera equipment",
      "Weekly photo critique sessions with peers",
      "Build a portfolio for internships and jobs",
    ],
    meetingSchedule: {
      day: "Friday",
      time: "4:00 pm - 5:30 pm",
      location: "Arts Center, Room 115",
    },
    upcomingEvents: [
      {
        id: "photo-evt-1",
        title: "Campus Photo Walk",
        emoji: "📷",
        date: "17 October 2025",
        time: "5:30 pm - 7:30 pm",
        location: "Meet at Main Quad Fountain",
        description:
          "Golden hour photo walk around campus. Bring your camera or phone — all skill levels welcome.",
        going: 14,
        headerImageUrl: "https://picsum.photos/seed/photo-evt1/600/280",
      },
      {
        id: "photo-evt-2",
        title: "Portfolio Review Night",
        emoji: "🖼️",
        date: "3 November 2025",
        time: "6:00 pm - 8:00 pm",
        location: "Arts Center, Room 115",
        description:
          "Share your best five shots and get constructive feedback from the group. Great for building your portfolio.",
        going: 20,
        headerImageUrl: "https://picsum.photos/seed/photo-evt2/600/280",
      },
    ],
    photos: [
      "https://picsum.photos/seed/photo-photo1/300/300",
      "https://picsum.photos/seed/photo-photo2/300/300",
      "https://picsum.photos/seed/photo-photo3/300/300",
    ],
    officers: [
      {
        id: "photo-o1",
        name: "Yuna Park",
        role: "President",
        avatarUrl: "https://picsum.photos/seed/photo-o1/80/80",
      },
      {
        id: "photo-o2",
        name: "Devon Mitchell",
        role: "Equipment Manager",
        avatarUrl: "https://picsum.photos/seed/photo-o2/80/80",
      },
    ],
    members: [
      { id: "photo-m1", name: "Yuna Park", avatarUrl: "https://picsum.photos/seed/photo-m1/60/60", isGluemate: true },
      { id: "photo-m2", name: "Devon Mitchell", avatarUrl: "https://picsum.photos/seed/photo-m2/60/60", isGluemate: true },
      { id: "photo-m3", name: "Clara James", avatarUrl: "https://picsum.photos/seed/photo-m3/60/60", isGluemate: false },
      { id: "photo-m4", name: "Matteo Ferrari", avatarUrl: "https://picsum.photos/seed/photo-m4/60/60", isGluemate: false },
      { id: "photo-m5", name: "Sasha Petrov", avatarUrl: "https://picsum.photos/seed/photo-m5/60/60", isGluemate: false },
      { id: "photo-m6", name: "Kenji Tanaka", avatarUrl: "https://picsum.photos/seed/photo-m6/60/60", isGluemate: false },
      { id: "photo-m7", name: "Rosa Delgado", avatarUrl: "https://picsum.photos/seed/photo-m7/60/60", isGluemate: false },
      { id: "photo-m8", name: "Owen Clarke", avatarUrl: "https://picsum.photos/seed/photo-m8/60/60", isGluemate: false },
      { id: "photo-m9", name: "Aaliyah Jones", avatarUrl: "https://picsum.photos/seed/photo-m9/60/60", isGluemate: false },
      { id: "photo-m10", name: "Felix Wagner", avatarUrl: "https://picsum.photos/seed/photo-m10/60/60", isGluemate: false },
    ],
  },
  {
    id: "international-org",
    name: "International Student Org",
    memberCount: 72,
    gluemates: 15,
    avatarUrl: "https://picsum.photos/seed/iso-avatar/100/100",
    headerImageUrl: "https://picsum.photos/seed/iso-header/600/220",
    about:
      "Celebrating cultures from around the world! Connect with global peers, share traditions, and feel at home.",
    keyBenefits: [
      "Build a global network across 40+ nationalities",
      "Access resources for visa and immigration support",
      "Celebrate cultural festivals together on campus",
    ],
    meetingSchedule: {
      day: "Thursday",
      time: "5:30 pm - 7:00 pm",
      location: "International Center, Room 204",
    },
    upcomingEvents: [
      {
        id: "iso-evt-1",
        title: "International Food Fair",
        emoji: "🌍",
        date: "25 October 2025",
        time: "11:00 am - 3:00 pm",
        location: "Main Lawn",
        description:
          "Taste dishes from over 20 countries brought by our own members. Free admission, donations welcome.",
        going: 120,
        headerImageUrl: "https://picsum.photos/seed/iso-evt1/600/280",
      },
      {
        id: "iso-evt-2",
        title: "Cultural Night Showcase",
        emoji: "🎭",
        date: "8 November 2025",
        time: "6:00 pm - 9:00 pm",
        location: "Student Union Theater",
        description:
          "An evening of performances, fashion, and storytelling celebrating the cultures within our community.",
        going: 85,
        headerImageUrl: "https://picsum.photos/seed/iso-evt2/600/280",
      },
    ],
    photos: [
      "https://picsum.photos/seed/iso-photo1/300/300",
      "https://picsum.photos/seed/iso-photo2/300/300",
      "https://picsum.photos/seed/iso-photo3/300/300",
    ],
    officers: [
      {
        id: "iso-o1",
        name: "Chidi Eze",
        role: "President",
        avatarUrl: "https://picsum.photos/seed/iso-o1/80/80",
      },
      {
        id: "iso-o2",
        name: "Lena Müller",
        role: "Cultural Director",
        avatarUrl: "https://picsum.photos/seed/iso-o2/80/80",
      },
      {
        id: "iso-o3",
        name: "Jordan Cruz",
        role: "Events Coordinator",
        avatarUrl: "https://picsum.photos/seed/iso-o3/80/80",
      },
    ],
    members: [
      { id: "iso-m1", name: "Chidi Eze", avatarUrl: "https://picsum.photos/seed/iso-m1/60/60", isGluemate: true },
      { id: "iso-m2", name: "Lena Müller", avatarUrl: "https://picsum.photos/seed/iso-m2/60/60", isGluemate: true },
      { id: "iso-m3", name: "Jordan Cruz", avatarUrl: "https://picsum.photos/seed/iso-m3/60/60", isGluemate: true },
      { id: "iso-m4", name: "Rania Aziz", avatarUrl: "https://picsum.photos/seed/iso-m4/60/60", isGluemate: true },
      { id: "iso-m5", name: "Hiroshi Yamamoto", avatarUrl: "https://picsum.photos/seed/iso-m5/60/60", isGluemate: true },
      { id: "iso-m6", name: "Ana Beatriz Costa", avatarUrl: "https://picsum.photos/seed/iso-m6/60/60", isGluemate: false },
      { id: "iso-m7", name: "Kwame Asante", avatarUrl: "https://picsum.photos/seed/iso-m7/60/60", isGluemate: false },
      { id: "iso-m8", name: "Pooja Mehta", avatarUrl: "https://picsum.photos/seed/iso-m8/60/60", isGluemate: false },
      { id: "iso-m9", name: "Olivier Dubois", avatarUrl: "https://picsum.photos/seed/iso-m9/60/60", isGluemate: false },
      { id: "iso-m10", name: "Min-Ji Oh", avatarUrl: "https://picsum.photos/seed/iso-m10/60/60", isGluemate: false },
      { id: "iso-m11", name: "Carlos Mendez", avatarUrl: "https://picsum.photos/seed/iso-m11/60/60", isGluemate: false },
      { id: "iso-m12", name: "Yara Al-Rashid", avatarUrl: "https://picsum.photos/seed/iso-m12/60/60", isGluemate: false },
      { id: "iso-m13", name: "Takeshi Ito", avatarUrl: "https://picsum.photos/seed/iso-m13/60/60", isGluemate: false },
      { id: "iso-m14", name: "Amina Kouyaté", avatarUrl: "https://picsum.photos/seed/iso-m14/60/60", isGluemate: false },
      { id: "iso-m15", name: "Stefan Popescu", avatarUrl: "https://picsum.photos/seed/iso-m15/60/60", isGluemate: false },
    ],
  },
];
