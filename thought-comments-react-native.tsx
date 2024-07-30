import {
  BottomSheetModal,
  BottomSheetModalProvider,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import {
  default as React,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { TextInput } from "react-native-gesture-handler";
import ReactNativeHapticFeedback from "react-native-haptic-feedback";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Custom Components
import { Text } from "../atoms";
import Avatar from "../components/Avatar";
import CBPressable from "../components/CBPressable";
import CustomBarScrollView from "../components/CustomBarScrollView";
import MyButton from "../components/MyButton";

// Constants and Context
import { Height } from "../constants/Layout";
import { useApp } from "../context/AppContext";

// Helpers and Utilities
import { axios, logError, triggerInAppRating } from "../helpers";

// Types and Interfaces
import {
  commentCoordsType,
  commentReactionsType,
  specialStatusType,
} from "../modals/CommentsModal";
import {
  profilePictureType,
  thoughtCommentTypes,
  thoughtsType,
} from "../types";

// Popups and Modals
import CommentReactionsPopup from "../popups/CommentReactionsPopup";
import ConfirmPopupScreen from "../popups/ConfirmPopupScreen";
import PopupScreen from "../popups/PopupScreen";

// Styles and Themes
import { Colors, SCALE, Styles } from "../theme";

export type ThoughtCommentDataType = {
  comment: string;
  creationDate: string;
  deleted: boolean;
  id: number;
  ownersName: string;
  ownersUserId: string;
  parentId: null | number;
  replies?: ThoughtCommentDataType[] | [];
  profilePicture: profilePictureType;
  isPublic: boolean;
  reactions: commentReactionsType;
  thoughtId: number;
  thoughtOwnersUserId: string;
};

type ThoughtModalType = {
  type: thoughtCommentTypes;
  id: number;
  ownersUserId: string;
};

export default function ThoughtsCommentsPopup({
  type,
  id,
  ownersUserId,
}: ThoughtModalType) {
  const {
    popModal,
    user: { profilePicture, name },
    setThoughts,
    triggerAlertNotice,
    setLoadingOverlay,
  } = useApp();

  const [specialStatus, setSpecialStatus] = useState<specialStatusType>(null);
  const [newComment, setNewComment] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [index, setIndex] = useState(0);
  const [keyboardStatus, setKeyboardStatus] = useState(false);
  const [comments, setComments] = useState<ThoughtCommentDataType[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const commentCoords = useRef<commentCoordsType>({});
  const inputRef = useRef<TextInput>(null);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const chosenCommentCoordRef = useRef<{ id?: number; y?: number } | null>(
    null
  );

  const reducedMotion = useReducedMotion();

  const { top: topSafeAreaHeight } = useSafeAreaInsets();

  function scrollTo(y: number) {
    scrollViewRef.current?.scrollTo({ y });
  }

  const bottomSheetModalRef = useRef<BottomSheetModal>(null);

  const snapPoints = useMemo(() => [Height - topSafeAreaHeight], []);

  useEffect(() => {
    bottomSheetModalRef.current?.present();
  }, []);

  const handleSheetChanges = useCallback((snapPointIndex: number) => {
    setIndex(snapPointIndex);
  }, []);

  function updateSpecialStatus(status: specialStatusType) {
    setSpecialStatus(status);
    if (status?.type) {
      inputRef.current?.focus();
    }
  }

  const getComments = useCallback(
    async function () {
      setLoadingOverlay(true);
      try {
        const { data } = await axios("get", `/thought/${id}/comments`);
        data.comments.forEach((comment: ThoughtCommentDataType) => {
          comment.reactions = comment.reactions || {};
          comment.replies?.forEach(
            (reply) => (reply.reactions = reply.reactions || {})
          );
        });
        setComments(data.comments);
      } catch (err) {
        logError(err);
        triggerAlertNotice("failed to get comments 👀", "sad");
        setTimeout(() => bottomSheetModalRef.current?.dismiss(), 1500);
      }
      setLoadingOverlay(false);
    },
    [id, setLoadingOverlay, triggerAlertNotice]
  );

  useEffect(() => {
    getComments();
  }, [getComments]);

  // This is how we handle scrolling to either a new comment posted or when reply is tapped and keyboard is opened
  useEffect(() => {
    if (chosenCommentCoordRef.current) {
      if (chosenCommentCoordRef.current.id) {
        const scrollSpot =
          commentCoords.current[chosenCommentCoordRef.current.id].y;
        scrollTo(scrollSpot);
        chosenCommentCoordRef.current = null;
      } else if (chosenCommentCoordRef.current.y) {
        const scrollSpot = chosenCommentCoordRef.current.y;
        scrollTo(scrollSpot);
        chosenCommentCoordRef.current = null;
      }
    }
  }, [keyboardStatus]);

  async function postComment(comment: string) {
    const route = `/thought/${id}/comments${
      specialStatus?.type ? `/${specialStatus.id}` : ""
    }`;
    setSubmitting(true);
    try {
      const { data } = await axios("post", route, {
        comment,
        isPublic: true,
      });
      data.profilePicture = profilePicture;
      appendComment(specialStatus?.id || null, data);
      setNewComment("");
      setSpecialStatus(null);
      Keyboard.dismiss();
      chosenCommentCoordRef.current = { id: data.id };
    } catch (err) {
      logError(err);
      triggerAlertNotice("Error posting comment", "sad");
      console.error(err);
    }
    setSubmitting(false);

    setThoughts((prevThoughts: thoughtsType) => {
      if (type === "users") {
        const updatedThoughts = prevThoughts.usersThoughts.thoughts.map(
          (thought) => {
            if (thought.id === id) {
              // Found the thought to update, increment commentCount
              const updatedCommentCount = (thought.commentCount || 0) + 1;
              // Return a new object for this thought with the updated commentCount
              return { ...thought, commentCount: updatedCommentCount };
            }
            // For thoughts that do not match, return them as they were
            return thought;
          }
        );

        // Return the new state with the updated thoughts array
        return {
          ...prevThoughts,
          usersThoughts: {
            ...prevThoughts.usersThoughts,
            thoughts: updatedThoughts,
          },
        };
        // Need to find the thought and then increase the commentCount
      } else {
        const updatedFriendsThoughts = prevThoughts.friendsThoughts.map(
          (friendsThoughtData) => {
            if (friendsThoughtData.ownersUserId === ownersUserId) {
              // Found the correct friendsThoughtData, now update the thought within it
              const updatedThoughts = friendsThoughtData.thoughts.map(
                (thought) => {
                  if (thought.id === id) {
                    // Found the thought to update, increment commentCount
                    const updatedCommentCount = (thought.commentCount || 0) + 1;
                    // Return a new object for this thought with the updated commentCount
                    return { ...thought, commentCount: updatedCommentCount };
                  }
                  // For thoughts that do not match, return them as they were
                  return thought;
                }
              );
              // Return the updated friendsThoughtData with the updated thoughts array
              return { ...friendsThoughtData, thoughts: updatedThoughts };
            }
            // For friendsThoughtData that does not match, return it as it was
            return friendsThoughtData;
          }
        );

        // Return the new state with the updated friendsThoughts array
        return {
          ...prevThoughts,
          friendsThoughts: updatedFriendsThoughts,
        };
      }
    });
  }

  async function deleteComment(commentId: number, parentId: null | number) {
    try {
      await axios("delete", `/thought/${id}/comments/${commentId}`);
      updateComment(commentId, parentId, { key: "deleted", val: true });
      decrementCommentCountOnThought();
    } catch (err) {
      logError(err);
    }
  }

  function updateComment(
    commentId: number,
    parentId: null | number,
    update: { key: "deleted"; val: true } | { key: "comment"; val: string }
  ) {
    setComments((prevComments) => {
      return prevComments.map((topLevelComment) => {
        if (topLevelComment.id === commentId) {
          return { ...topLevelComment, [update.key]: update.val };
        } else if (topLevelComment.id === parentId) {
          return {
            ...topLevelComment,
            replies: (topLevelComment.replies || []).map((reply) => {
              if (reply.id === commentId) {
                return { ...reply, [update.key]: update.val };
              } else {
                return reply;
              }
            }),
          };
        } else {
          return topLevelComment;
        }
      });
    });
  }

  function decrementCommentCountOnThought() {
    setThoughts((prevThoughts) => {
      if (type === "users") {
        const updatedThoughts = prevThoughts.usersThoughts.thoughts.map(
          (thought) => {
            if (thought.id === id) {
              // Found the thought to update, increment commentCount
              const updatedCommentCount = (thought.commentCount || 0) - 1;
              // Return a new object for this thought with the updated commentCount
              return { ...thought, commentCount: updatedCommentCount };
            }
            // For thoughts that do not match, return them as they were
            return thought;
          }
        );

        // Return the new state with the updated thoughts array
        return {
          ...prevThoughts,
          usersThoughts: {
            ...prevThoughts.usersThoughts,
            thoughts: updatedThoughts,
          },
        };
        // Need to find the thought and then increase the commentCount
      } else {
        const updatedFriendsThoughts = prevThoughts.friendsThoughts.map(
          (friendsThoughtData) => {
            if (friendsThoughtData.ownersUserId === ownersUserId) {
              // Found the correct friendsThoughtData, now update the thought within it
              const updatedThoughts = friendsThoughtData.thoughts.map(
                (thought) => {
                  if (thought.id === id) {
                    // Found the thought to update, increment commentCount
                    const updatedCommentCount = (thought.commentCount || 0) - 1;
                    // Return a new object for this thought with the updated commentCount
                    return { ...thought, commentCount: updatedCommentCount };
                  }
                  // For thoughts that do not match, return them as they were
                  return thought;
                }
              );
              // Return the updated friendsThoughtData with the updated thoughts array
              return { ...friendsThoughtData, thoughts: updatedThoughts };
            }
            // For friendsThoughtData that does not match, return it as it was
            return friendsThoughtData;
          }
        );

        // Return the new state with the updated friendsThoughts array
        return {
          ...prevThoughts,
          friendsThoughts: updatedFriendsThoughts,
        };
      }
    });
  }

  function clearNewComment() {
    setNewComment("");
  }

  function appendComment(
    parentId: null | number,
    commentToAdd: ThoughtCommentDataType
  ) {
    setComments((prevComments) => {
      if (parentId === null) {
        return [...prevComments, commentToAdd];
      } else {
        return prevComments.map((topLevelComment) => {
          if (topLevelComment.id === parentId) {
            return {
              ...topLevelComment,
              replies: [...(topLevelComment.replies || []), commentToAdd],
            };
          } else {
            return topLevelComment;
          }
        });
      }
    });
  }

  useEffect(() => {
    const showSubscription = Keyboard.addListener("keyboardDidShow", () => {
      setKeyboardStatus(true);
    });
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardStatus(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  return (
    <View
      style={{
        position: "absolute",
        width: "100%",
        height: "100%",
      }}
    >
      <BottomSheetModalProvider>
        <BottomSheetModal
          ref={bottomSheetModalRef}
          index={index}
          animateOnMount={!reducedMotion}
          snapPoints={snapPoints}
          onChange={handleSheetChanges}
          keyboardBehavior="extend"
          onDismiss={() => {
            popModal();
          }}
          handleIndicatorStyle={{
            backgroundColor: Colors.grey70,
            height: SCALE * 3,
            borderRadius: SCALE * 6,
            width: SCALE * 50,
          }}
          style={{
            backgroundColor: Colors.white,
            borderTopWidth: SCALE * 1,
            borderTopRightRadius: SCALE * 6,
            borderTopLeftRadius: SCALE * 6,
            borderRightWidth: SCALE * 1,
            borderLeftWidth: SCALE * 1,
          }}
        >
          <CBPressable
            onPress={() => bottomSheetModalRef.current?.dismiss()}
            style={{
              paddingTop: SCALE * 10,
              paddingBottom: SCALE * 12,
              borderBottomWidth: SCALE * 1,
            }}
          >
            <Text
              style={{
                fontSize: SCALE * 16,
                fontWeight: "600",
                textAlign: "center",
              }}
            >
              Comments
            </Text>
          </CBPressable>
          <CustomBarScrollView
            Ref={scrollViewRef}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="always"
            customOnScroll={() => setInputFocused(false)}
            style={{ ...Styles.tightPadding }}
          >
            {comments.map((commentData, i) => (
              <ThoughtComments
                key={commentData.id}
                commentData={commentData}
                updateSpecialStatus={updateSpecialStatus}
                commentCoords={commentCoords}
                scrollTo={scrollTo}
                keyboardStatus={keyboardStatus}
                chosenCommentCoordRef={chosenCommentCoordRef}
                clearNewComment={clearNewComment}
                index={i}
                deleteComment={deleteComment}
                setComments={setComments}
              />
            ))}
          </CustomBarScrollView>
          {(newComment || inputFocused) && specialStatus?.type && (
            <View
              style={{
                ...Styles.row,
                justifyContent: "space-between",
                backgroundColor: Colors.grey90,
                ...Styles.standardPadding,
                ...Styles.borderTop,
                alignItems: "center",
              }}
            >
              {(newComment || inputFocused) && (
                <>
                  <Text>
                    {specialStatus?.type +
                      (specialStatus?.to ? ` to ${specialStatus?.to}` : "")}
                  </Text>
                  {specialStatus?.type && (
                    <BottomSheetView
                      style={{ ...Styles.row, alignItems: "center" }}
                    >
                      <CBPressable
                        onPress={() => {
                          updateSpecialStatus(null);
                          setNewComment("");
                        }}
                        hitSlop={12}
                      >
                        <Image
                          style={{
                            height: SCALE * 15,
                            width: SCALE * 15,
                            ...Styles.tightMargin,
                          }}
                          source={require("../../assets/images/X.png")}
                        />
                      </CBPressable>
                    </BottomSheetView>
                  )}
                </>
              )}
            </View>
          )}
          <Pressable
            style={{
              ...Styles.row,
              ...Styles.standardPadding,
              gap: 10,
              alignItems: "center",
              borderTopWidth: SCALE * 1,
              paddingBottom: inputFocused ? SCALE * 6 : SCALE * 30,
            }}
            onPress={() => inputRef.current?.focus()}
            hitSlop={12}
          >
            <BottomSheetView
              style={{ alignSelf: "flex-start", paddingTop: SCALE * 2 }}
            >
              <Avatar profilePicture={profilePicture} size={40} name={name} />
            </BottomSheetView>
            <BottomSheetView
              style={{
                minHeight: SCALE * 34,
                maxHeight: SCALE * 160,
                flex: 1,
                ...Styles.border,
                backgroundColor: "white",
                ...Styles.smolRound,
              }}
            >
              <BottomSheetTextInput
                onBlur={() => setInputFocused(false)}
                onFocus={() => {
                  setInputFocused(true);
                  ReactNativeHapticFeedback.trigger("impactMedium");
                }}
                style={{
                  ...Styles.tightPadding,
                  ...Styles.mediumText,
                  fontFamily: "Roboto mono",
                }}
                multiline
                selectionColor={Colors.blue}
                placeholder={
                  specialStatus?.type ? "add your reply" : "add a comment"
                }
                keyboardType="twitter"
                defaultValue={newComment}
                onChangeText={(val) => {
                  if (!val && val !== "") return;
                  setNewComment(val);
                }}
                ref={inputRef}
              />
            </BottomSheetView>
            <BottomSheetView style={{ alignSelf: "flex-end" }}>
              <MyButton
                isDisabled={!newComment || submitting}
                color="white"
                buttonStyle={{ paddingHorizontal: 4, paddingVertical: 0 }}
                text=""
                onPress={() => postComment(newComment)}
                content={
                  <Image
                    style={{ height: SCALE * 32, width: SCALE * 32 }}
                    resizeMode="contain"
                    source={require("../../assets/images/airplane.png")}
                  />
                }
              />
            </BottomSheetView>
          </Pressable>
        </BottomSheetModal>
      </BottomSheetModalProvider>
    </View>
  );
}

type CommentRowType = {
  commentData: ThoughtCommentDataType;
  updateSpecialStatus: (status: specialStatusType) => void;
  commentCoords: React.MutableRefObject<commentCoordsType>;
  scrollTo: (y: number) => void;
  keyboardStatus: boolean;
  chosenCommentCoordRef: any;
  clearNewComment: () => void;
  index: number;
  deleteComment: (commentId: number, parentId: null | number) => void;
  setComments: React.Dispatch<React.SetStateAction<ThoughtCommentDataType[]>>;
};

function ThoughtComments({
  commentData,
  updateSpecialStatus,
  commentCoords,
  scrollTo,
  keyboardStatus,
  chosenCommentCoordRef,
  clearNewComment,
  index,
  deleteComment,
  setComments,
}: CommentRowType) {
  const {
    user: { id: userId, name: userName },
    triggerAlertNotice,
  } = useApp();
  const {
    isPublic,
    comment,
    creationDate,
    ownersName,
    deleted,
    profilePicture,
    thoughtId,
    reactions,
    ownersUserId,
    parentId,
    id: commentId,
  } = commentData;

  const date = new Date(Number(creationDate))
    .toLocaleTimeString("en-us", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    ?.replace("at ", "");

  const hearts = reactions[1];
  const ownComment = ownersUserId === userId;
  const userHasHearted =
    (!ownComment && hearts?.some((heart: any) => heart.userId === userId)) ||
    false;

  const [hasHeartedLocal, setHasHeartedLocal] = useState(userHasHearted);
  const [reacting, setReacting] = useState(false);
  const [showHearts, setShowHearts] = useState(false);
  const [showDeleteComment, setShowDeleteComment] = useState(false);

  const type: any = "friends";

  const popupSection = useMemo(
    () => (
      <>
        <PopupScreen
          show={showDeleteComment}
          component={
            <ConfirmPopupScreen
              closePopup={() => setShowDeleteComment(false)}
              confirmCallback={() => deleteComment(commentId, parentId)}
              title="Delete comment"
              confirmMessage="Are you sure you want to delete this comment?"
            />
          }
        />
        <PopupScreen
          show={showHearts}
          component={
            <CommentReactionsPopup
              reactions={hearts || []}
              closePopup={() => setShowHearts(false)}
            />
          }
        />
      </>
    ),
    [showDeleteComment, showHearts, hearts, deleteComment, parentId, commentId]
  );

  const handleCommentReaction = async () => {
    if (!reacting) {
      setReacting(true);
      try {
        const previousHasHearted = userHasHearted;
        setHasHeartedLocal(!userHasHearted);
        await axios(
          previousHasHearted ? "delete" : "post",
          `/thought/${thoughtId}/comments/${commentId}/reaction/1`
        );
        setComments((prevComments) =>
          updateCommentReaction(
            prevComments,
            commentId,
            previousHasHearted,
            userName,
            userId
          )
        );
        triggerInAppRating();
      } catch (err) {
        logError(err);
        triggerAlertNotice("could not add reaction right now", "sad");
        setHasHeartedLocal(userHasHearted);
      }
      setReacting(false);
    }
  };

  const updateCommentReaction = (
    comments: ThoughtCommentDataType[],
    targetId: Number,
    previousHasHearted: Boolean,
    name: String,
    usersId: String
  ): any => {
    const newReaction = { name, userId: usersId };
    return comments.map((singleComment: ThoughtCommentDataType) => {
      if (singleComment.id === targetId) {
        return {
          ...singleComment,
          reactions: {
            ...singleComment.reactions,
            [1]: !previousHasHearted
              ? [...(singleComment.reactions[1] || []), newReaction]
              : (singleComment.reactions[1] || []).filter(
                  (reaction: any) => reaction.userId !== userId
                ),
          },
        };
      } else if (singleComment.replies && singleComment.replies.length > 0) {
        return {
          ...singleComment,
          replies: updateCommentReaction(
            singleComment.replies,
            targetId,
            previousHasHearted,
            userName,
            userId
          ),
        };
      }
      return singleComment;
    });
  };

  return (
    <>
      <View
        style={{
          ...Styles.row,
          gap: 8,
          borderTopWidth: index ? SCALE * 1 : 0,
          paddingTop: 6 * SCALE,
          paddingBottom: SCALE * 10,
          marginRight: SCALE * 10,
          borderColor: Colors.grey90,
          marginLeft: parentId ? SCALE * 26 : 10,
          flex: 1,
        }}
        onLayout={(evt) => {
          const { height, y } = evt.nativeEvent.layout;
          commentCoords.current[commentId] = { height, y };
        }}
      >
        <Avatar profilePicture={profilePicture} name={ownersName} size={30} />
        <View style={{ flex: 1 }}>
          <View
            style={{ flex: 1, ...Styles.row, justifyContent: "space-between" }}
          >
            <Text style={{ ...Styles.h6 }}>{ownersName}</Text>
            <View style={{ ...Styles.row }}>
              {!isPublic ? (
                <Image
                  style={{
                    height: SCALE * 14,
                    width: SCALE * 14,
                    marginRight: SCALE * 6,
                    opacity: 0.5,
                  }}
                  source={require("../../assets/images/padlock.png")}
                />
              ) : null}
              <Text style={{ color: Colors.grey60, ...Styles.smolText }}>
                {date.split(",").join("")}
              </Text>
            </View>
          </View>
          <View style={{ ...Styles.row, ...Styles.standardMarginVertical }}>
            <Text
              style={{
                ...Styles.mediumText,
                color: deleted ? Colors.grey60 : "black",
                flex: 1,
                paddingRight: 3 * SCALE,
              }}
            >
              {deleted ? "Comment was deleted" : comment}
            </Text>
            {!ownComment ? (
              <CBPressable
                disabled={reacting}
                onPress={() => handleCommentReaction()}
              >
                <Text
                  style={{
                    height: 20,
                    width: 20,
                    opacity: hasHeartedLocal ? 1 : 0.2,
                  }}
                >
                  ❤️
                </Text>
              </CBPressable>
            ) : null}
          </View>
          {type !== "past" && !deleted ? (
            <View
              style={{
                alignSelf: "flex-start",
                flexDirection: "row",
                gap: SCALE * 24,
              }}
            >
              {hearts?.length ? (
                <TouchableOpacity
                  onPress={() => {
                    setShowHearts(true);
                    ReactNativeHapticFeedback.trigger("impactMedium");
                  }}
                >
                  <Text style={{ ...Styles.h5, color: Colors.grey70 }}>{`${
                    hearts?.length || 0
                  } heart${hearts?.length === 1 ? "" : "s"}`}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                onPress={() => {
                  updateSpecialStatus({
                    id: parentId || commentId,
                    type: "replying",
                    to: ownersName,
                    isPublic,
                  });
                  clearNewComment();
                  if (keyboardStatus) {
                    scrollTo(commentCoords.current[commentId].y);
                  } else {
                    chosenCommentCoordRef.current = {
                      y: commentCoords.current[commentId].y,
                    };
                  }
                }}
              >
                <Text style={{ ...Styles.h5, color: Colors.blue }}>
                  {"reply"}
                </Text>
              </TouchableOpacity>
              {ownComment && (
                <TouchableOpacity onPress={() => setShowDeleteComment(true)}>
                  <Text style={{ ...Styles.h5, color: Colors.grey70 }}>
                    {"delete"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null}
        </View>
      </View>
      {commentData.replies?.map((replyData) => (
        <ThoughtComments
          commentData={replyData}
          key={replyData.id}
          updateSpecialStatus={updateSpecialStatus}
          commentCoords={commentCoords}
          scrollTo={scrollTo}
          keyboardStatus={keyboardStatus}
          chosenCommentCoordRef={chosenCommentCoordRef}
          index={1} // want first reply to still have bar
          deleteComment={deleteComment}
          clearNewComment={clearNewComment}
          setComments={setComments}
        />
      ))}
      {popupSection}
    </>
  );
}
