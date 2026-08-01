// ─── We Glue — Terms & Conditions (single legal document) ────────────────────
//
// Source of truth for the in-app Terms & Conditions screen (mobile) and the
// weglue.app/terms page (web). The Privacy Policy is a normal section inside
// this same document — one screen, one scroll, no separate legal links.
//
// Content derived from the founder-provided legal document ("T & C (2).pdf"),
// cleaned up for consistency: one effective date, deduplicated sections,
// single continuous numbering, no placeholder notes, no links.

export const LEGAL_EFFECTIVE_DATE = 'August 20, 2026';
export const LEGAL_CONTACT_EMAIL = 'zylvana.arellano.campos@gmail.com';

export interface LegalSection {
  /** Section heading, e.g. "3. Eligibility and Age Requirements" */
  heading: string;
  /** Paragraphs. Items starting with "• " render as bullet points. */
  body: string[];
}

export const TERMS_AND_CONDITIONS_TITLE = 'Terms & Conditions';

export const TERMS_AND_CONDITIONS_INTRO: string[] = [
  `These Terms and Conditions are effective as of ${LEGAL_EFFECTIVE_DATE}.`,
  'By accessing or using the We Glue website, the We Glue service, or any applications (including mobile applications) made available by We Glue (together, the "Service"), however accessed, you agree to be bound by these Terms and Conditions ("Terms"). The Service is owned or controlled by We Glue. These Terms affect your legal rights and obligations. If you do not agree to be bound by all of these Terms, do not access or use the Service.',
  'ARBITRATION NOTICE: EXCEPT IF YOU OPT OUT AND EXCEPT FOR CERTAIN TYPES OF DISPUTES DESCRIBED IN THE ARBITRATION SECTION BELOW, YOU AGREE THAT DISPUTES BETWEEN YOU AND WE GLUE WILL BE RESOLVED BY BINDING, INDIVIDUAL ARBITRATION AND YOU WAIVE YOUR RIGHT TO PARTICIPATE IN A CLASS ACTION LAWSUIT OR CLASS-WIDE ARBITRATION.',
  'These Terms form a legally binding agreement between you ("User", "you") and We Glue ("We Glue", "we", "us", "our"). These Terms govern your access to and use of all We Glue services, including but not limited to our mobile application, website, features, content, and all official We Glue social media accounts (collectively, the "Services").',
  'We Glue is a non-commercial, non-revenue-generating, community-based platform created solely to support students. We Glue is not a for-profit company, does not sell goods or services, and does not provide professional, medical, legal, or mental health services.',
  'By accessing, registering, downloading, or using the Services, you confirm that you have read, understood, and agreed to these Terms. If you do not agree, you must not use the Services.',
];

export const TERMS_AND_CONDITIONS_SECTIONS: LegalSection[] = [
  {
    heading: '1. Acceptance and Scope',
    body: [
      'These Terms apply to:',
      '• The We Glue mobile application',
      '• The We Glue website',
      '• All official We Glue social media pages (including Instagram, TikTok, LinkedIn, X, and future platforms)',
      '• Any interaction, message, post, comment, or content associated with We Glue',
      'Your use of any We Glue-controlled platform constitutes acceptance of these Terms.',
    ],
  },
  {
    heading: '2. Eligibility and Age Requirements',
    body: [
      '• You must be at least 17 years old to use We Glue.',
      '• Parents or guardians assume full responsibility for the actions of minors.',
      '• We Glue may request age verification and suspend or terminate accounts that provide false information.',
    ],
  },
  {
    heading: '3. Account Registration and Security',
    body: [
      '• You agree to provide accurate and truthful information. You represent that all information you provide or provided to We Glue upon registration and at all other times will be true, accurate, current, and complete, and you agree to update your information as necessary to maintain its truth and accuracy.',
      '• You are solely responsible for all activity that occurs under your account.',
      '• You are responsible for keeping your password secret and secure, and you may not share passwords or login credentials.',
      '• You agree that you will not solicit, collect, or use the login credentials of other We Glue users.',
      '• You will not sell, transfer, license, or assign your account, followers, username, or any account rights. With the exception of people or clubs that are expressly authorized to create accounts on behalf of their clubs or members, We Glue prohibits the creation of, and you agree that you will not create, an account for anyone other than yourself.',
      '• You must not create accounts with the Service through unauthorized means, including but not limited to using an automated device, script, bot, spider, crawler, or scraper.',
      'Security disclaimer: We Glue is not responsible for hacking, unauthorized access, lost credentials, data breaches, or account misuse. You assume all risk related to account security.',
    ],
  },
  {
    heading: '4. User Conduct and Prohibited Behavior',
    body: [
      'You agree not to:',
      '• Harass, threaten, stalk, bully, defame, abuse, impersonate, or intimidate people or entities',
      '• Send repeated unwanted messages',
      '• Post violent, nude, partially nude, discriminatory, unlawful, infringing, hateful, pornographic, or sexually suggestive photos or other content via the Service',
      '• Promote self-harm, suicide, or eating disorders',
      '• Impersonate others or misrepresent your identity',
      '• Share illegal, deceptive, or fraudulent content',
      '• Post private or confidential information via the Service, including, without limitation, your or any other person\'s credit card information, social security or alternate national identity numbers, non-public phone numbers, or non-public email addresses',
      '• Introduce worms, viruses, spyware, malware, or any other code of a destructive or disruptive nature, or otherwise attempt to exploit the platform',
      '• Create or submit unwanted email, comments, likes, or other forms of harassing communications ("spam") to any We Glue users',
      '• Use domain names or web URLs in your username without prior written consent from We Glue',
      '• Interfere with or disrupt the Service or servers or networks connected to the Service, or inject content or code or otherwise alter or interfere with the way any We Glue page is rendered or displayed in a user\'s browser or device',
      '• Change, modify, adapt, or alter the Service, or change, modify, or alter another website so as to falsely imply that it is associated with the Service or We Glue',
      '• Access We Glue\'s private API by means other than those permitted by We Glue',
      '• Crawl, scrape, cache, or otherwise access any content on the Service via automated means, including but not limited to user profiles and photos (except as may be the result of standard search engine protocols or technologies used with We Glue\'s express consent)',
      '• Attempt to restrict another user from using or enjoying the Service, or encourage or facilitate violations of these Terms',
      '• Use the Service for any illegal or unauthorized purpose',
      'You agree to comply with all laws, rules, and regulations (for example, federal, state, local, and provincial) applicable to your use of the Service and your Content (defined below), including but not limited to copyright laws.',
      'Violation of these Terms may result in immediate and permanent account termination, without notice.',
    ],
  },
  {
    heading: '5. Zero-Tolerance Policy',
    body: [
      'We Glue enforces a zero-tolerance policy for:',
      '• Cyberbullying',
      '• Harassment',
      '• Threats',
      '• Abuse',
      'Accounts engaging in such behavior may be permanently banned, blocked across devices, or removed without appeal.',
    ],
  },
  {
    heading: '6. User-Generated Content',
    body: [
      'You are solely responsible for your conduct and any data, text, files, information, usernames, student ID, teacher ID, images, graphics, photos, profiles, audio and video clips, sounds, musical works, works of authorship, applications, links, and other content or materials (collectively, "Content") that you submit, post, or display on or via the Service.',
      '• You retain ownership of your Content. We Glue does not claim ownership of any Content that you post on or through the Service. You can always choose who can view some of your personal information through your account privacy center.',
      '• By posting on We Glue, you grant We Glue a worldwide, perpetual, irrevocable, royalty-free, sublicensable license to host, use, display, reproduce, modify, and distribute such Content for platform operation and safety.',
      '• You represent that you have the legal right to post all Content you post.',
      'We Glue does not endorse, verify, or assume responsibility for user Content. If your Content violates these Terms, you and only you will bear legal responsibility for that Content.',
      'You acknowledge and agree that your relationship with We Glue is not a confidential, fiduciary, or other type of special relationship, and that your decision to submit any Content does not place We Glue in a position that is any different from the position held by members of the general public, including with regard to your Content. None of your Content will be subject to any obligation of confidence on the part of We Glue, and We Glue will not be liable for any use or disclosure of any Content you provide.',
    ],
  },
  {
    heading: '7. Service Availability and Content Removal',
    body: [
      'We reserve the right to modify or terminate the Service or your access to the Service for any reason, without notice, at any time, and without liability to you. You can deactivate your We Glue account at any time. If you deactivate your account, your photos, comments, likes, friendships, and all other data will no longer be accessible through your account, but those materials and data may persist and appear within the Service (for example, if your Content has been reshared by others).',
      'We reserve the right to refuse access to the Service to anyone for any reason at any time, and to force forfeiture of any username for any reason.',
      'We may, but have no obligation to, remove, edit, block, and/or monitor Content or accounts containing Content that we determine in our sole discretion violates these Terms.',
      'Although it is We Glue\'s intention for the Service to be available as much as possible, there will be occasions when the Service may be interrupted, including, without limitation, for scheduled maintenance or upgrades, for emergency repairs, or due to failure of telecommunications links and/or equipment. We Glue reserves the right to remove any Content from the Service for any reason, without prior notice. Content removed from the Service may continue to be stored by We Glue, including, without limitation, in order to comply with certain legal obligations. We Glue is not a backup service, and you agree that you will not rely on the Service for the purposes of Content backup or storage. We Glue will not be liable to you for any modification, suspension, or discontinuation of the Services, or the loss of any Content. You also acknowledge that the Internet may be subject to breaches of security and that the submission of Content or other information may not be secure.',
      'You are solely responsible for your interaction with other users of the Service, whether online or offline. You agree that We Glue is not responsible or liable for the conduct of any user. We Glue reserves the right, but has no obligation, to monitor or become involved in disputes between you and other users. Exercise common sense and your best judgment when interacting with others, including when you submit or post Content or any personal or other information.',
      'You agree that you are responsible for all data charges you incur through use of the Service.',
    ],
  },
  {
    heading: '8. Intellectual Property',
    body: [
      'The Service contains content owned or licensed by We Glue ("We Glue Content"). We Glue Content is protected by copyright, trademark, patent, trade secret, and other laws, and, as between you and We Glue, We Glue owns and retains all rights in the We Glue Content and the Service. You will not remove, alter, or conceal any copyright, trademark, service mark, or other proprietary rights notices incorporated in or accompanying the We Glue Content, and you will not reproduce, modify, adapt, prepare derivative works based on, perform, display, publish, distribute, transmit, broadcast, sell, license, or otherwise exploit the We Glue Content.',
      'The We Glue name and logo are trademarks of We Glue and may not be copied, imitated, or used, in whole or in part, without the prior written permission of We Glue. In addition, all page headers, custom graphics, button icons, and scripts are service marks, trademarks, and/or trade dress of We Glue, and may not be copied, imitated, or used, in whole or in part, without prior written permission from We Glue.',
      'We respect other people\'s rights, and expect you to do the same. If you repeatedly infringe other people\'s intellectual property rights, we will disable your account when appropriate.',
    ],
  },
  {
    heading: '9. Feedback and Unsolicited Ideas',
    body: [
      'It is We Glue\'s policy not to accept or consider content, information, ideas, suggestions, or other materials other than those we have specifically requested. This is to avoid any misunderstandings if your ideas are similar to those we have developed or are developing independently. Accordingly, We Glue does not accept unsolicited materials or ideas, and takes no responsibility for any materials or ideas so transmitted. If, despite our policy, you choose to send us content, information, ideas, suggestions, or other materials, you agree that We Glue is free to use any such content, information, ideas, suggestions, or other materials for any purpose consistent with our non-commercial mission, without any liability or payment of any kind to you.',
    ],
  },
  {
    heading: '10. Mental Health, Self-Harm, and Suicide Disclaimer',
    body: [
      '• We Glue is not a crisis line, therapist, or medical provider.',
      '• We Glue does not monitor or intervene in mental health emergencies.',
      '• We Glue disclaims all liability for harm, injury, emotional distress, or death resulting from user interactions or content.',
      '• Users are responsible for seeking professional help.',
    ],
  },
  {
    heading: '11. Safety and Emergencies',
    body: [
      '• We Glue is not obligated to intervene if we believe there is a risk of harm, self-harm, suicide, violence, or other emergencies.',
      '• We Glue may contact emergency services or law enforcement at its discretion.',
      '• We Glue is not responsible for the outcome of any emergency action or inaction.',
    ],
  },
  {
    heading: '12. Reporting, Moderation, and Enforcement',
    body: [
      '• Users may report violations.',
      '• Users may block other users. Blocking and reporting are separate actions: blocking is a personal control you apply to your own experience, and reporting asks We Glue to review someone\'s behavior. You can do either, both, or neither.',
      '• Blocking is immediate and the blocked person is not notified. It prevents direct discovery and direct communication between the two accounts. It does not remove either person from clubs, events or group conversations you already share, and it does not hide official club or event information.',
      '• Blocking is a choice you make about your own account. It is NOT a We Glue enforcement action, it is not a penalty applied to the other person, and it does not by itself cause us to review or act on their behavior. If you want us to review someone, report them.',
      '• We Glue may remove content or accounts at any time, with or without notice.',
      '• We Glue may restrict an account\'s access to the Service — temporarily, or until we lift the restriction. A restriction is an access decision: it does not by itself delete your content, and it is separate from any block another user has applied. You can still delete your account while your access is restricted.',
      '• We Glue is not required to monitor all activity.',
      'If you violate the letter or spirit of these Terms, or otherwise create risk or possible legal exposure for We Glue, we can stop providing all or part of the Service to you. You understand and agree that We Glue cannot and will not be responsible for the Content posted on the Service, and you use the Service at your own risk.',
    ],
  },
  {
    heading: '13. Third-Party Services',
    body: [
      'We Glue is not responsible for third-party links, platforms, or services.',
      'There may be links from the Service, or from communications you receive from the Service, to third-party websites or features. For example, the Service may include a feature that enables you to share Content from the Service or your Content with a third party, which may be publicly posted on that third party\'s service or application. Using this functionality typically requires you to log in to your account on the third-party service, and you do so at your own risk. We Glue does not control any of these third-party web services or any of their content. You expressly acknowledge and agree that We Glue is in no way responsible or liable for any such third-party services or features. YOUR CORRESPONDENCE AND CLUB DEALINGS WITH THIRD PARTIES FOUND THROUGH THE SERVICE ARE SOLELY BETWEEN YOU AND THE THIRD PARTY.',
      'You may choose, at your sole and absolute discretion and risk, to use applications that connect the Service or your profile on the Service with a third-party service (each, an "Application"), and such Application may interact with, connect to, or gather and/or pull information from and to your Service profile. By using such Applications, you acknowledge and agree that: (i) if you use an Application to share information, you are consenting to information about your profile on the Service being shared; (ii) your use of an Application may cause personally identifying information to be publicly disclosed and/or associated with you, even if We Glue has not itself provided such information; and (iii) your use of an Application is at your own option and risk, and you will hold the We Glue Parties harmless for activity related to the Application.',
    ],
  },
  {
    heading: '14. App Store and Google Play Compliance',
    body: [
      '• Apple and Google are third-party beneficiaries of these Terms.',
      '• We Glue, not Apple or Google, is responsible for the Services.',
      '• Apple and Google have no obligation to provide support for the Services.',
    ],
  },
  {
    heading: '15. Disclaimer of Warranties',
    body: [
      'THE SERVICE, INCLUDING, WITHOUT LIMITATION, WE GLUE CONTENT, IS PROVIDED ON AN "AS IS", "AS AVAILABLE", AND "WITH ALL FAULTS" BASIS. TO THE FULLEST EXTENT PERMISSIBLE BY LAW, NEITHER WE GLUE NOR ANYONE INVOLVED IN IT MAKES ANY REPRESENTATIONS OR WARRANTIES OR ENDORSEMENTS OF ANY KIND WHATSOEVER, EXPRESS OR IMPLIED, AS TO: (A) THE SERVICE; (B) THE WE GLUE CONTENT; (C) USER CONTENT; OR (D) SECURITY ASSOCIATED WITH THE TRANSMISSION OF INFORMATION TO WE GLUE OR VIA THE SERVICE. IN ADDITION, THE WE GLUE PARTIES HEREBY DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING, BUT NOT LIMITED TO, THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, TITLE, CUSTOM, TRADE, QUIET ENJOYMENT, SYSTEM INTEGRATION, AND FREEDOM FROM COMPUTER VIRUS.',
      'THE WE GLUE PARTIES DO NOT REPRESENT OR WARRANT THAT THE SERVICE WILL BE ERROR-FREE OR UNINTERRUPTED; THAT DEFECTS WILL BE CORRECTED; OR THAT THE SERVICE OR THE SERVER THAT MAKES THE SERVICE AVAILABLE IS FREE FROM ANY HARMFUL COMPONENTS, INCLUDING, WITHOUT LIMITATION, VIRUSES. THE WE GLUE PARTIES DO NOT MAKE ANY REPRESENTATIONS OR WARRANTIES THAT THE INFORMATION (INCLUDING ANY INSTRUCTIONS) ON THE SERVICE IS ACCURATE, COMPLETE, OR USEFUL. YOU ACKNOWLEDGE THAT YOUR USE OF THE SERVICE IS AT YOUR SOLE RISK. THE WE GLUE PARTIES DO NOT WARRANT THAT YOUR USE OF THE SERVICE IS LAWFUL IN ANY PARTICULAR JURISDICTION, AND THE WE GLUE PARTIES SPECIFICALLY DISCLAIM SUCH WARRANTIES. SOME JURISDICTIONS LIMIT OR DO NOT ALLOW THE DISCLAIMER OF IMPLIED OR OTHER WARRANTIES, SO THE ABOVE DISCLAIMER MAY NOT APPLY TO YOU TO THE EXTENT SUCH JURISDICTION\'S LAW IS APPLICABLE TO YOU AND THESE TERMS.',
      'BY ACCESSING OR USING THE SERVICE, YOU REPRESENT AND WARRANT THAT YOUR ACTIVITIES ARE LAWFUL IN EVERY JURISDICTION WHERE YOU ACCESS OR USE THE SERVICE.',
      'THE WE GLUE PARTIES DO NOT ENDORSE CONTENT AND SPECIFICALLY DISCLAIM ANY RESPONSIBILITY OR LIABILITY TO ANY PERSON OR ENTITY FOR ANY LOSS, DAMAGE (WHETHER ACTUAL, CONSEQUENTIAL, PUNITIVE, OR OTHERWISE), INJURY, CLAIM, LIABILITY, OR OTHER CAUSE OF ANY KIND OR CHARACTER BASED UPON OR RESULTING FROM ANY CONTENT.',
    ],
  },
  {
    heading: '16. Limitation of Liability; Waiver',
    body: [
      'UNDER NO CIRCUMSTANCES WILL THE WE GLUE PARTIES BE LIABLE TO YOU FOR ANY LOSS OR DAMAGES OF ANY KIND (INCLUDING, WITHOUT LIMITATION, FOR ANY DIRECT, INDIRECT, ECONOMIC, EXEMPLARY, SPECIAL, PUNITIVE, INCIDENTAL, OR CONSEQUENTIAL LOSSES OR DAMAGES) THAT ARE DIRECTLY OR INDIRECTLY RELATED TO: (A) THE SERVICE; (B) THE WE GLUE CONTENT; (C) USER CONTENT; (D) YOUR USE OF, INABILITY TO USE, OR THE PERFORMANCE OF THE SERVICE; (E) ANY ACTION TAKEN IN CONNECTION WITH AN INVESTIGATION BY THE WE GLUE PARTIES OR LAW ENFORCEMENT AUTHORITIES REGARDING YOUR OR ANY OTHER PARTY\'S USE OF THE SERVICE; (F) ANY ACTION TAKEN IN CONNECTION WITH COPYRIGHT OR OTHER INTELLECTUAL PROPERTY OWNERS; (G) ANY ERRORS OR OMISSIONS IN THE SERVICE\'S OPERATION; OR (H) ANY DAMAGE TO ANY USER\'S COMPUTER, MOBILE DEVICE, OR OTHER EQUIPMENT OR TECHNOLOGY, INCLUDING, WITHOUT LIMITATION, DAMAGE FROM ANY SECURITY BREACH OR FROM ANY VIRUS, BUGS, TAMPERING, FRAUD, ERROR, OMISSION, INTERRUPTION, DEFECT, DELAY IN OPERATION OR TRANSMISSION, COMPUTER LINE OR NETWORK FAILURE, OR ANY OTHER TECHNICAL OR OTHER MALFUNCTION, INCLUDING, WITHOUT LIMITATION, DAMAGES FOR LOST PROFITS, LOSS OF GOODWILL, LOSS OF DATA, WORK STOPPAGE, ACCURACY OF RESULTS, OR COMPUTER FAILURE OR MALFUNCTION, EVEN IF FORESEEABLE OR EVEN IF THE WE GLUE PARTIES HAVE BEEN ADVISED OF OR SHOULD HAVE KNOWN OF THE POSSIBILITY OF SUCH DAMAGES, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE, STRICT LIABILITY, OR TORT (INCLUDING, WITHOUT LIMITATION, WHETHER CAUSED IN WHOLE OR IN PART BY NEGLIGENCE, ACTS OF GOD, TELECOMMUNICATIONS FAILURE, OR THEFT OR DESTRUCTION OF THE SERVICE). IN NO EVENT WILL THE WE GLUE PARTIES BE LIABLE TO YOU OR ANYONE ELSE FOR LOSS, DAMAGE, OR INJURY, INCLUDING, WITHOUT LIMITATION, DEATH OR PERSONAL INJURY. SOME STATES DO NOT ALLOW THE EXCLUSION OR LIMITATION OF INCIDENTAL OR CONSEQUENTIAL DAMAGES, SO THE ABOVE LIMITATION OR EXCLUSION MAY NOT APPLY TO YOU.',
      'YOU AGREE THAT IN THE EVENT YOU INCUR ANY DAMAGES, LOSSES, OR INJURIES THAT ARISE OUT OF WE GLUE\'S ACTS OR OMISSIONS, THE DAMAGES, IF ANY, CAUSED TO YOU ARE NOT IRREPARABLE OR SUFFICIENT TO ENTITLE YOU TO AN INJUNCTION PREVENTING ANY EXPLOITATION OF ANY WEBSITE, SERVICE, PROPERTY, PRODUCT, OR OTHER CONTENT OWNED OR CONTROLLED BY THE WE GLUE PARTIES, AND YOU WILL HAVE NO RIGHTS TO ENJOIN OR RESTRAIN THE DEVELOPMENT, PRODUCTION, DISTRIBUTION, ADVERTISING, EXHIBITION, OR EXPLOITATION OF ANY WEBSITE, PROPERTY, PRODUCT, SERVICE, OR OTHER CONTENT OWNED OR CONTROLLED BY THE WE GLUE PARTIES.',
      'BY ACCESSING THE SERVICE, YOU UNDERSTAND THAT YOU MAY BE WAIVING RIGHTS WITH RESPECT TO CLAIMS THAT ARE AT THIS TIME UNKNOWN OR UNSUSPECTED, AND IN ACCORDANCE WITH SUCH WAIVER, YOU ACKNOWLEDGE THAT YOU HAVE READ AND UNDERSTAND, AND HEREBY EXPRESSLY WAIVE, THE FOLLOWING: "A GENERAL RELEASE DOES NOT EXTEND TO CLAIMS WHICH THE CREDITOR DOES NOT KNOW OR SUSPECT TO EXIST IN HIS FAVOR AT THE TIME OF EXECUTING THE RELEASE, WHICH IF KNOWN BY HIM MUST HAVE MATERIALLY AFFECTED HIS SETTLEMENT WITH THE DEBTOR."',
      'WE GLUE IS NOT RESPONSIBLE FOR THE ACTIONS, CONTENT, INFORMATION, OR DATA OF THIRD PARTIES, AND YOU RELEASE US AND OUR FOUNDERS FROM ANY CLAIMS AND DAMAGES, KNOWN AND UNKNOWN, ARISING OUT OF OR IN ANY WAY CONNECTED WITH ANY CLAIM YOU HAVE AGAINST ANY SUCH THIRD PARTIES.',
    ],
  },
  {
    heading: '17. Indemnification',
    body: [
      'You (and also any third party for whom you operate an account or activity on the Service) agree to defend (at We Glue\'s request), indemnify, and hold the We Glue Parties harmless from and against any claims, liabilities, damages, losses, and expenses, including, without limitation, reasonable attorney\'s fees and costs, arising out of or in any way connected with any of the following (including as a result of your direct activities on the Service or those conducted on your behalf): (i) your Content or your access to or use of the Service; (ii) your breach or alleged breach of these Terms; (iii) your violation of any third-party right, including, without limitation, any intellectual property right, publicity, confidentiality, property, or privacy right; (iv) your violation of any laws, rules, regulations, codes, statutes, ordinances, or orders of any governmental and quasi-governmental authorities, including, without limitation, all regulatory, administrative, and legislative authorities; or (v) any misrepresentation made by you.',
      'You will cooperate as fully required by We Glue in the defense of any claim. We Glue reserves the right to assume the exclusive defense and control of any matter subject to indemnification by you, and you will not in any event settle any claim without the prior written consent of We Glue.',
    ],
  },
  {
    heading: '18. Arbitration Agreement and Class Action Waiver',
    body: [
      'PLEASE READ CAREFULLY.',
      'Except if you opt out, and except for disputes relating to: (1) your or We Glue\'s intellectual property (such as trademarks, trade dress, domain names, trade secrets, copyrights, and patents); or (2) violations of the API Terms — you agree that all disputes between you and We Glue (whether or not such dispute involves a third party) with regard to your relationship with We Glue, including, without limitation, disputes related to these Terms, your use of the Service, and/or rights of privacy and/or publicity, will be resolved by binding, individual arbitration under the American Arbitration Association\'s rules for arbitration of consumer-related disputes, and you and We Glue hereby expressly waive trial by jury.',
      'As an alternative, you may bring your claim in your local "small claims" court, if permitted by that small claims court\'s rules. You may bring claims only on your own behalf. Neither you nor We Glue will participate in a class action or class-wide arbitration for any claims covered by this agreement. You also agree not to participate in claims brought in a private attorney general or representative capacity, or consolidated claims involving another person\'s account, if We Glue is a party to the proceeding.',
      'This dispute resolution provision will be governed by the Federal Arbitration Act. In the event the American Arbitration Association is unwilling or unable to set a hearing date within one hundred and sixty (160) days of filing the case, then either We Glue or you can elect to have the arbitration administered instead by the Judicial Arbitration and Mediation Services. Judgment on the award rendered by the arbitrator may be entered in any court having competent jurisdiction. Any provision of applicable law notwithstanding, the arbitrator will not have authority to award damages, remedies, or awards that conflict with these Terms.',
      'You may opt out of this agreement to arbitrate. If you do so, neither you nor We Glue can require the other to participate in an arbitration proceeding. To opt out, you must notify We Glue in writing within 30 days of the date that you first became subject to this arbitration provision.',
      'If the prohibition against class actions and other claims brought on behalf of third parties contained above is found to be unenforceable, then all of the preceding language in this Arbitration section will be null and void. This arbitration agreement will survive the termination of your relationship with We Glue.',
    ],
  },
  {
    heading: '19. Time Limitation on Claims',
    body: [
      'You agree that any claim you may have arising out of or related to your relationship with We Glue must be filed within one year after such claim arose; otherwise, your claim is permanently barred.',
    ],
  },
  {
    heading: '20. Governing Law and Jurisdiction',
    body: [
      'These Terms are governed by the laws of the State of Texas, United States. Any permitted court proceedings shall take place exclusively in Texas.',
    ],
  },
  {
    heading: '21. Termination',
    body: [
      'We Glue may suspend or terminate access at any time without notice. Upon termination, all licenses and other rights granted to you in these Terms will immediately cease.',
    ],
  },
  {
    heading: '22. Changes to These Terms',
    body: [
      'We reserve the right, in our sole discretion, to change these Terms and the Privacy Policy ("Updated Terms") from time to time. You should review these Terms and any Updated Terms before using the Service. Updates may be made without advance notice; by continuing to use the Service after an update takes effect, you accept the Updated Terms. The Updated Terms will be effective as of the time of posting, or such later date as may be specified in the Updated Terms, and will apply to your use of the Service from that point forward. These Terms will govern any disputes arising before the effective date of the Updated Terms.',
    ],
  },
  {
    heading: '23. Territorial Restrictions',
    body: [
      'The information provided within the Service is not intended for distribution to or use by any person or entity in any jurisdiction or country where such distribution or use would be contrary to law or regulation or which would subject We Glue to any registration requirement within such jurisdiction or country. We reserve the right to limit the availability of the Service, or any portion of the Service, to any person, geographic area, or jurisdiction, at any time and in our sole discretion, and to limit the quantities of any content, program, or other feature that We Glue provides.',
    ],
  },
  {
    heading: '24. Entire Agreement',
    body: [
      'If you are using the Service on behalf of a legal entity, you represent that you are authorized to enter into an agreement on behalf of that legal entity. These Terms constitute the entire agreement between you and We Glue and govern your use of the Service, superseding any prior agreements between you and We Glue. You will not assign these Terms or assign any rights or delegate any obligations hereunder, in whole or in part, whether voluntarily or by operation of law, without the prior written consent of We Glue. Any purported assignment or delegation by you without the appropriate prior written consent of We Glue will be null and void.',
    ],
  },
  {
    heading: '25. Language',
    body: [
      `These Terms are effective as of ${LEGAL_EFFECTIVE_DATE} and were written in English (US). If you do not understand English, you will need to translate them. We Glue is not liable for any language barriers that a person or user may have.`,
      'BY USING WE GLUE, YOU AGREE TO THESE TERMS IN FULL.',
    ],
  },
  {
    heading: 'Privacy Policy',
    body: [
      `Last updated: ${LEGAL_EFFECTIVE_DATE}`,
      'This Privacy Policy explains how We Glue ("We Glue", "we", "us") collects, uses, stores, and protects information when you use our Services, including our mobile application, website, and official social media accounts.',
      'We Glue is a non-commercial, student-support platform and does not sell personal data.',
    ],
  },
  {
    heading: 'A. Information We Collect',
    body: [
      'Information you provide:',
      '• Name, username, email address, student or teacher ID, birthday, password (stored securely in encrypted form), majors, interests, and profile picture',
      '• Profile information, messages, and photos',
      '• Content you voluntarily submit',
      'We only collect information that is necessary to provide and improve the We Glue experience.',
      'Information from third parties: We Glue does not sell, rent, or trade your personal information to third parties. Your data may only be shared when required by law, or when necessary to protect the safety, rights, or integrity of users or the platform.',
    ],
  },
  {
    heading: 'B. How We Use Information',
    body: [
      'We use the information we collect to:',
      '• Create and manage your We Glue account',
      '• Verify your student status',
      '• Personalize your experience (such as showing relevant clubs, events, or connections)',
      '• Enable communication and interaction within the app',
      '• Operate, maintain, and improve app functionality and user experience',
      '• Enforce safety and moderation, and prevent abuse, fraud, and misuse of the platform',
      '• Communicate platform updates',
      '• Comply with legal obligations',
      'Your information is not used for advertising purposes.',
    ],
  },
  {
    heading: 'C. Sharing of Information',
    body: [
      'Information may be shared:',
      '• With trusted service providers',
      '• To comply with law enforcement',
      '• To protect safety and rights',
      'We Glue does not sell personal data.',
    ],
  },
  {
    heading: 'D. Children\'s Privacy',
    body: [
      'We Glue is intended for college students.',
      '• You must be at least 17 years old to use We Glue.',
      '• Parents or guardians assume full responsibility for the actions of minors.',
    ],
  },
  {
    heading: 'E. Data Retention',
    body: [
      'We retain data only as long as necessary for safety, legal, and operational purposes.',
    ],
  },
  {
    heading: 'F. Data Security',
    body: [
      '• Reasonable safeguards are used to protect your information.',
      '• No system is completely secure.',
      '• We Glue disclaims liability for breaches.',
    ],
  },
  {
    heading: 'G. Your Rights',
    body: [
      'You may:',
      '• Update or edit your profile information within the app',
      `• Request deletion of your account and associated data within the app or by contacting us at ${LEGAL_CONTACT_EMAIL}`,
    ],
  },
  {
    heading: 'H. International Transfers',
    body: ['Data may be processed in the United States.'],
  },
  {
    heading: 'I. Social Media',
    body: [
      'This Privacy Policy applies to interactions on official We Glue social media accounts.',
    ],
  },
  {
    heading: 'J. Changes to This Policy',
    body: [
      'We may update this Privacy Policy from time to time. Any changes will be posted within the app or on our website.',
    ],
  },
  {
    heading: 'K. Contact',
    body: [
      `Privacy concerns and any questions about these Terms may be submitted through official We Glue channels or by email: ${LEGAL_CONTACT_EMAIL}`,
      `This Privacy Policy is effective as of ${LEGAL_EFFECTIVE_DATE} and was written in English (US). If you do not understand English, you will need to translate it. We Glue is not liable for any language barriers that a person or user may have.`,
      'BY USING WE GLUE, YOU AGREE TO THESE TERMS IN FULL.',
    ],
  },
];
